import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentExecutor, ExecutorEventSink, ExecutorRunInput } from '@agentdock/agent-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaimExecuteLoop } from './claim-execute-loop.js';
import type {
  ClaimResponse,
  CompleteRunInput,
  RunEventType,
  RunnerClient,
} from './runner-client.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

/** Create a throwaway git repo with one commit on `main`. */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentdock-claimloop-'));
  await git(dir, ['init', '--quiet', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@agentdock.dev']);
  await git(dir, ['config', 'user.name', 'AgentDock Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), 'base\n');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '--quiet', '-m', 'init']);
  return dir;
}

/** Create a bare repo to use as a push target ("origin"). */
async function makeBareRemote(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentdock-claimloop-remote-'));
  await git(dir, ['init', '--quiet', '--bare', '-b', 'main']);
  return dir;
}

function claimedWork(
  repo: string,
  overrides: Partial<{ testCommand: string; intent: 'fix' | 'general' }> = {},
) {
  return {
    claimed: true as const,
    work: {
      run: {
        id: 'run_1',
        taskId: 'task_1',
        executor: 'opencode',
        status: 'assigned',
        cancelRequested: false,
      },
      task: {
        id: 'task_1',
        intent: overrides.intent ?? ('fix' as const),
        source: 'web' as const,
        prompt: 'Fix the bug',
      },
      project: {
        id: 'proj_1',
        name: 'demo',
        workspaceKey: 'demo',
        defaultBranch: 'main',
        testCommand: overrides.testCommand,
        workspacePath: repo,
      },
    },
  };
}

/** Minimal fake RunnerClient: records every call for assertions. */
function fakeClient(claimResponses: ClaimResponse[]): RunnerClient & {
  events: { runId: string; type: RunEventType; payload?: unknown }[];
  completions: { runId: string; input: CompleteRunInput }[];
} {
  const events: { runId: string; type: RunEventType; payload?: unknown }[] = [];
  const completions: { runId: string; input: CompleteRunInput }[] = [];
  let claimIndex = 0;

  return {
    events,
    completions,
    register: vi.fn(),
    heartbeat: vi.fn(),
    claim: vi.fn(async () => {
      const response = claimResponses[claimIndex] ?? { claimed: false };
      claimIndex = Math.min(claimIndex + 1, claimResponses.length - 1);
      return response;
    }),
    appendEvent: vi.fn(async (runId: string, type: RunEventType, payload?: unknown) => {
      events.push({ runId, type, payload });
      return {
        id: 'evt',
        runId,
        seq: events.length,
        type,
        payload,
        createdAt: new Date().toISOString(),
      };
    }),
    runHeartbeat: vi.fn(async (runId: string) => ({
      runId,
      status: 'running',
      cancelRequested: false,
    })),
    complete: vi.fn(async (runId: string, input: CompleteRunInput) => {
      completions.push({ runId, input });
      return {
        id: runId,
        taskId: 'task_1',
        executor: 'opencode',
        status: input.status,
        cancelRequested: false,
      };
    }),
  } as unknown as RunnerClient & {
    events: { runId: string; type: RunEventType; payload?: unknown }[];
    completions: { runId: string; input: CompleteRunInput }[];
  };
}

/** Fake executor that succeeds without producing artifacts. */
function fakeExecutor(
  behavior: (input: ExecutorRunInput, sink: ExecutorEventSink) => ReturnType<AgentExecutor['run']>,
): AgentExecutor {
  return {
    id: 'fake',
    canRun: vi.fn(async () => ({ ready: true })),
    run: vi.fn(behavior),
    cancel: vi.fn(async () => {}),
  };
}

describe('ClaimExecuteLoop.tick', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('does nothing when claim returns claimed: false', async () => {
    const client = fakeClient([{ claimed: false }]);
    const executor = fakeExecutor(async () => ({ status: 'succeeded', artifacts: [] }));
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    expect(client.claim).toHaveBeenCalledTimes(1);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('runs the full pipeline and completes as succeeded when evidence is satisfied', async () => {
    // `general` intent requires no evidence, so a clean run with a real
    // change should succeed once verify/commit finish.
    const client = fakeClient([claimedWork(repo, { intent: 'general' })]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    expect(client.completions).toHaveLength(1);
    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('succeeded');
    expect(completion?.artifacts?.some((a) => a.type === 'diff')).toBe(true);
    expect(completion?.artifacts?.some((a) => a.type === 'commit')).toBe(true);

    const statusEvents = client.events
      .filter((e) => e.type === 'status')
      .map((e) => (e.payload as { status: string }).status);
    expect(statusEvents).toEqual(['running', 'verifying', 'publishing']);
  });

  it('fails with evidence_incomplete when governance rules are unmet (fix requires a PR)', async () => {
    // `fix` requires git_changes + test_result + commit + pull_request; no
    // test command is configured and no PR artifact exists, so completion
    // must be decided as failed by evidence, not by the executor's own claim.
    const client = fakeClient([claimedWork(repo)]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('failed');
    expect(completion?.errorCode).toBe('evidence_incomplete');
    expect(completion?.errorMessage).toContain('pull_request');
  });

  it('completes as failed when the test command fails', async () => {
    const client = fakeClient([claimedWork(repo, { testCommand: 'node -e "process.exit(1)"' })]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('failed');
    expect(completion?.errorCode).toBe('verification_failed');
    expect(completion?.artifacts?.some((a) => a.type === 'test_result')).toBe(true);
  });

  it('completes as failed when the executor itself reports failure', async () => {
    const client = fakeClient([claimedWork(repo)]);
    const executor = fakeExecutor(async () => ({
      status: 'failed',
      artifacts: [],
      summary: 'agent gave up',
    }));
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('failed');
    expect(completion?.errorCode).toBe('executor_failed');
    expect(completion?.errorMessage).toBe('agent gave up');
  });

  it('completes as cancelled when the executor reports cancellation', async () => {
    const client = fakeClient([claimedWork(repo)]);
    const executor = fakeExecutor(async () => ({ status: 'cancelled', artifacts: [] }));
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('cancelled');
  });

  it('ignores a concurrent tick while a run is already in flight', async () => {
    const client = fakeClient([claimedWork(repo)]);
    let resolveRun: (() => void) | undefined;
    const executor = fakeExecutor(
      () =>
        new Promise((resolve) => {
          resolveRun = () => resolve({ status: 'succeeded', artifacts: [] });
        }),
    );
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    const firstTick = loop.tick();
    // Give the first tick a chance to reach `executor.run` and set `resolveRun`.
    await vi.waitFor(() => expect(resolveRun).toBeDefined());
    await loop.tick(); // should be a no-op since busy
    expect(client.claim).toHaveBeenCalledTimes(1);

    resolveRun?.();
    await firstTick;
  });
});

describe('ClaimExecuteLoop push behavior', () => {
  let repo: string;
  let remote: string;

  beforeEach(async () => {
    repo = await makeRepo();
    remote = await makeBareRemote();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  });

  it('does not push when getPushConfig is absent (default commit-only behavior)', async () => {
    await git(repo, ['remote', 'add', 'origin', remote]);
    const client = fakeClient([claimedWork(repo, { intent: 'general' })]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const loop = new ClaimExecuteLoop({ client, pollIntervalMs: 1000, executor });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('succeeded');
    expect(completion?.artifacts?.some((a) => a.metadata?.pushed)).toBe(false);
  });

  it('pushes the agent branch and records a pushed commit artifact when enabled', async () => {
    await git(repo, ['remote', 'add', 'origin', remote]);
    const client = fakeClient([claimedWork(repo, { intent: 'general' })]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const loop = new ClaimExecuteLoop({
      client,
      pollIntervalMs: 1000,
      executor,
      getPushConfig: () => ({ enabled: true, remote: 'origin', protectedBranches: [] }),
    });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('succeeded');
    const pushed = completion?.artifacts?.find((a) => a.metadata?.pushed === true);
    expect(pushed).toBeDefined();
    expect(pushed?.metadata?.remote).toBe('origin');

    const branches = await execFileAsync('git', ['branch', '--list'], { cwd: remote });
    expect(branches.stdout).toMatch(/agent\//);
  });

  it('logs and continues (without failing the run) when push has no remote configured', async () => {
    // No `origin` configured on this repo at all.
    const client = fakeClient([claimedWork(repo, { intent: 'general' })]);
    const executor = fakeExecutor(async (input) => {
      await writeFile(join(input.workspaceCwd, 'fix.txt'), 'patched\n');
      return { status: 'succeeded', artifacts: [] };
    });
    const logs: string[] = [];
    const loop = new ClaimExecuteLoop({
      client,
      pollIntervalMs: 1000,
      executor,
      getPushConfig: () => ({ enabled: true, remote: 'origin', protectedBranches: [] }),
      onLog: (message) => logs.push(message),
    });

    await loop.tick();

    const completion = client.completions[0]?.input;
    expect(completion?.status).toBe('succeeded');
    expect(logs.some((l) => l.includes('push skipped'))).toBe(true);
  });
});
