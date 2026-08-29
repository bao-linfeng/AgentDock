import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { VerificationResult } from '@agentdock/protocol';
import { AGENT_BRANCH_PREFIX, WORKTREE_DIR, slugify } from '@agentdock/shared';

const execFileAsync = promisify(execFile);

/** Max bytes of verification output retained (avoid unbounded logs / secrets bloat). */
const MAX_VERIFICATION_OUTPUT = 64 * 1024;

export interface WorktreeHandle {
  runId: string;
  branch: string;
  worktreePath: string;
  baseBranch: string;
}

export interface PushOptions {
  /** Git remote to push to. Defaults to `origin`. */
  remote?: string;
  /**
   * Branches that must never be pushed to directly (the run's own agent
   * branch is always allowed regardless of this list). Defaults to the
   * worktree's `baseBranch`.
   */
  protectedBranches?: string[];
}

export interface PushResult {
  remote: string;
  branch: string;
  pushed: boolean;
  /** Set when `pushed` is false because there is no configured remote. */
  reason?: string;
}

export interface ChangeSummary {
  changedFiles: string[];
  insertions: number;
  deletions: number;
  hasChanges: boolean;
}

export class GitRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitRuntimeError';
  }
}

/** Compute the agent branch name for a run. */
export function agentBranchName(taskId: string, title: string): string {
  return `${AGENT_BRANCH_PREFIX}${taskId}-${slugify(title)}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new GitRuntimeError(
      `git ${args.join(' ')} failed: ${(err.stderr || err.message || '').trim()}`,
    );
  }
}

/** True when `child` resolves to a path inside (or equal to) `root`. */
function isContained(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Manages isolated Git worktrees for runs.
 *
 * Every run gets a dedicated branch (`agent/<task>-<slug>`) and a worktree under
 * `<projectRoot>/.agent-worktrees/<runId>`, keeping changes off the base branch
 * (docs/architecture.md §10, docs/requirements.md §8). All paths are validated to
 * stay contained under the project root (root containment, §14).
 */
export class WorktreeManager {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  worktreeRoot(): string {
    return join(this.projectRoot, WORKTREE_DIR);
  }

  worktreePathFor(runId: string): string {
    return join(this.worktreeRoot(), runId);
  }

  private assertContained(path: string): void {
    if (!isContained(this.projectRoot, path)) {
      throw new GitRuntimeError(`path escapes project root (containment violation): ${path}`);
    }
  }

  /**
   * fetch base, create the agent branch from it, and add an isolated worktree.
   * Fails if the base branch has uncommitted changes in the main checkout is NOT
   * checked here — isolation comes from the dedicated worktree/branch.
   */
  async create(runId: string, baseBranch: string, branch: string): Promise<WorktreeHandle> {
    const worktreePath = this.worktreePathFor(runId);
    this.assertContained(worktreePath);

    // Best-effort fetch; offline/local-only repos still work.
    try {
      await git(this.projectRoot, ['fetch', '--quiet', 'origin', baseBranch]);
    } catch {
      // no remote / offline — proceed with local base ref
    }

    await this.assertBaseExists(baseBranch);

    await git(this.projectRoot, [
      'worktree',
      'add',
      '--quiet',
      '-b',
      branch,
      worktreePath,
      baseBranch,
    ]);

    return { runId, branch, worktreePath, baseBranch };
  }

  private async assertBaseExists(baseBranch: string): Promise<void> {
    try {
      await git(this.projectRoot, ['rev-parse', '--verify', '--quiet', `${baseBranch}^{commit}`]);
    } catch {
      throw new GitRuntimeError(`base branch not found: ${baseBranch}`);
    }
  }

  /**
   * Compute net changes of the worktree relative to its base branch, including
   * committed changes, uncommitted modifications, and untracked files.
   */
  async detectChanges(handle: WorktreeHandle): Promise<ChangeSummary> {
    this.assertContained(handle.worktreePath);

    const changed = new Set<string>();
    let insertions = 0;
    let deletions = 0;

    // Tracked diff (committed + unstaged) vs base branch.
    const numstat = await git(handle.worktreePath, ['diff', '--numstat', handle.baseBranch, '--']);
    for (const line of numstat.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [ins, del, ...fileParts] = trimmed.split('\t');
      const file = fileParts.join('\t');
      if (!file) continue;
      changed.add(file);
      // Binary files report '-'.
      insertions += ins === '-' ? 0 : Number.parseInt(ins ?? '0', 10) || 0;
      deletions += del === '-' ? 0 : Number.parseInt(del ?? '0', 10) || 0;
    }

    // Untracked new files.
    const untracked = await git(handle.worktreePath, [
      'ls-files',
      '--others',
      '--exclude-standard',
    ]);
    for (const line of untracked.split('\n')) {
      const file = line.trim();
      if (!file) continue;
      changed.add(file);
      insertions += await countLines(join(handle.worktreePath, file));
    }

    const changedFiles = [...changed].sort();
    return {
      changedFiles,
      insertions,
      deletions,
      hasChanges: changedFiles.length > 0,
    };
  }

  /**
   * Stage all changes in the worktree and commit them.
   *
   * Local commit only — pushing to `origin` and opening a Pull Request are
   * out of scope here and tracked separately (docs/tasks.md T5.4, #27):
   * this repo has no GitHub App / token wiring yet (#28), so a push target
   * doesn't exist. Returns `null` when there is nothing to commit.
   */
  async commit(handle: WorktreeHandle, message: string): Promise<string | null> {
    this.assertContained(handle.worktreePath);

    const changes = await this.detectChanges(handle);
    if (!changes.hasChanges) return null;

    await git(handle.worktreePath, ['add', '-A']);
    // `--allow-empty` is intentionally omitted: `hasChanges` already guards this.
    await git(handle.worktreePath, ['commit', '--quiet', '-m', message]);
    const sha = (await git(handle.worktreePath, ['rev-parse', 'HEAD'])).trim();
    return sha;
  }

  /**
   * Push the run's agent branch to a remote (PR-first workflow, docs/tasks.md
   * T5.4, docs/architecture.md §14). Direct pushes to the base/default branch
   * or any other configured protected branch are refused — the agent branch
   * itself is always pushable since that's the whole point of this method.
   *
   * Reuses whatever git credentials/remote are already configured in the
   * project's checkout (the same ones a human `git push` would use); no
   * separate token wiring is required here (that's for the GitHub API side,
   * #28/#30). Returns `pushed: false` (rather than throwing) when there is no
   * such remote configured, so offline/local-only repos degrade gracefully.
   */
  async push(handle: WorktreeHandle, options: PushOptions = {}): Promise<PushResult> {
    this.assertContained(handle.worktreePath);

    const remote = options.remote ?? 'origin';
    const protectedBranches = new Set(options.protectedBranches ?? [handle.baseBranch]);
    if (protectedBranches.has(handle.branch)) {
      throw new GitRuntimeError(`refusing to push protected branch directly: ${handle.branch}`);
    }

    const remotes = (await git(handle.worktreePath, ['remote'])).split('\n').map((r) => r.trim());
    if (!remotes.includes(remote)) {
      return { remote, branch: handle.branch, pushed: false, reason: `no such remote: ${remote}` };
    }

    await git(handle.worktreePath, [
      'push',
      '--quiet',
      '--set-upstream',
      remote,
      `HEAD:refs/heads/${handle.branch}`,
    ]);

    return { remote, branch: handle.branch, pushed: true };
  }

  /** Remove the worktree and prune its administrative entry. */
  async cleanup(handle: WorktreeHandle): Promise<void> {
    this.assertContained(handle.worktreePath);
    try {
      await git(this.projectRoot, ['worktree', 'remove', '--force', handle.worktreePath]);
    } catch {
      // Worktree dir already gone — fall back to a filesystem removal + prune.
      await rm(handle.worktreePath, { recursive: true, force: true });
    }
    await git(this.projectRoot, ['worktree', 'prune']);
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const content = await readFile(path, 'utf8');
    if (content.length === 0) return 0;
    const nl = (content.match(/\n/g) || []).length;
    return content.endsWith('\n') ? nl : nl + 1;
  } catch {
    return 0;
  }
}

export interface VerificationOptions {
  cwd: string;
  command: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * Run a configured verification (test/build) command inside the worktree and
 * capture a bounded, structured result. Never throws on a non-zero exit — a
 * failing command is a valid `VerificationResult` with `passed: false`.
 */
export async function runVerification(options: VerificationOptions): Promise<VerificationResult> {
  const { cwd, command } = options;
  const maxBytes = options.maxOutputBytes ?? MAX_VERIFICATION_OUTPUT;
  const timeout = options.timeoutMs ?? 10 * 60_000;

  try {
    const { stdout, stderr } = await execFileAsync(command, {
      cwd,
      shell: true,
      timeout,
      windowsHide: true,
      maxBuffer: maxBytes * 2,
    });
    return {
      command,
      exitCode: 0,
      passed: true,
      output: boundedTail(`${stdout}${stderr}`, maxBytes),
    };
  } catch (error) {
    const err = error as {
      code?: number | string;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const exitCode = typeof err.code === 'number' ? err.code : err.killed ? 124 : 1;
    const combined = `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message || '';
    return {
      command,
      exitCode,
      passed: false,
      output: boundedTail(combined, maxBytes),
    };
  }
}

/** Keep only the trailing `maxBytes` of output (failures matter most at the end). */
function boundedTail(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `…[truncated ${text.length - maxBytes} chars]\n${text.slice(text.length - maxBytes)}`;
}
