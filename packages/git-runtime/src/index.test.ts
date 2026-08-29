import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitRuntimeError, WorktreeManager, agentBranchName, runVerification } from './index.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

/** Create a throwaway git repo with one commit on `main`. */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentdock-git-'));
  await git(dir, ['init', '--quiet', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@agentdock.dev']);
  await git(dir, ['config', 'user.name', 'AgentDock Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), 'base\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '--quiet', '-m', 'init']);
  return dir;
}

describe('agentBranchName', () => {
  it('builds a slugified agent branch', () => {
    expect(agentBranchName('task_1', 'Fix Payment Callback!')).toBe(
      'agent/task_1-fix-payment-callback',
    );
  });
});

describe('WorktreeManager', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('creates an isolated worktree + branch under .agent-worktrees', async () => {
    const mgr = new WorktreeManager(repo);
    const handle = await mgr.create('run_1', 'main', 'agent/run_1-demo');

    expect(handle.branch).toBe('agent/run_1-demo');
    expect(handle.worktreePath).toBe(mgr.worktreePathFor('run_1'));
    expect(handle.worktreePath.startsWith(mgr.worktreeRoot())).toBe(true);

    const branches = await execFileAsync('git', ['branch', '--list'], { cwd: repo });
    expect(branches.stdout).toContain('agent/run_1-demo');
  });

  it('detects no changes on a fresh worktree', async () => {
    const mgr = new WorktreeManager(repo);
    const handle = await mgr.create('run_2', 'main', 'agent/run_2');
    const summary = await mgr.detectChanges(handle);
    expect(summary.hasChanges).toBe(false);
    expect(summary.changedFiles).toEqual([]);
  });

  it('detects committed, modified and untracked changes vs base', async () => {
    const mgr = new WorktreeManager(repo);
    const handle = await mgr.create('run_3', 'main', 'agent/run_3');

    // committed change
    await writeFile(join(handle.worktreePath, 'a.txt'), 'one\ntwo\n');
    await git(handle.worktreePath, ['add', '-A']);
    await git(handle.worktreePath, ['commit', '--quiet', '-m', 'add a']);
    // untracked new file
    await writeFile(join(handle.worktreePath, 'b.txt'), 'x\ny\nz\n');
    // modify tracked base file
    await writeFile(join(handle.worktreePath, 'README.md'), 'base\nmore\n');

    const summary = await mgr.detectChanges(handle);
    expect(summary.hasChanges).toBe(true);
    expect(summary.changedFiles).toEqual(['README.md', 'a.txt', 'b.txt']);
    // a.txt: +2, b.txt untracked: +3, README: +1
    expect(summary.insertions).toBe(6);
    expect(summary.deletions).toBe(0);
  });

  it('cleans up the worktree', async () => {
    const mgr = new WorktreeManager(repo);
    const handle = await mgr.create('run_4', 'main', 'agent/run_4');
    await mgr.cleanup(handle);
    const list = await execFileAsync('git', ['worktree', 'list'], { cwd: repo });
    expect(list.stdout).not.toContain('run_4');
  });

  it('throws on a missing base branch', async () => {
    const mgr = new WorktreeManager(repo);
    await expect(mgr.create('run_5', 'nope', 'agent/run_5')).rejects.toBeInstanceOf(
      GitRuntimeError,
    );
  });
});

describe('runVerification', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('captures a passing command', async () => {
    const result = await runVerification({ cwd: repo, command: 'node -e "process.exit(0)"' });
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('captures a failing command with exit code, without throwing', async () => {
    const result = await runVerification({ cwd: repo, command: 'node -e "process.exit(3)"' });
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(3);
  });
});
