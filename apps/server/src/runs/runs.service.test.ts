import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TaskRun } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RunEventsBus } from '../events/run-events.bus.js';
import type { PullRequestService } from '../github/pull-request.service.js';
import type { RunCallbackService } from '../github/run-callback.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RunsService, redactPayload, statusFromPayload } from './runs.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function run(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    runnerId: null,
    executor: 'opencode',
    status: 'queued',
    branch: null,
    worktreePath: null,
    startedAt: null,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TaskRun;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any>): PrismaService {
  return overrides as unknown as PrismaService;
}

function fakePullRequests(
  // biome-ignore lint/suspicious/noExplicitAny: minimal structural stub
  openForRun: any = vi.fn().mockResolvedValue(null),
): PullRequestService {
  return { openForRun } as unknown as PullRequestService;
}

function fakeCallbacks(): RunCallbackService {
  return { post: vi.fn().mockResolvedValue(undefined) } as unknown as RunCallbackService;
}

function service(
  prisma: PrismaService,
  pullRequests?: PullRequestService,
  callbacks?: RunCallbackService,
): RunsService {
  return new RunsService(
    prisma,
    new RunEventsBus(),
    pullRequests ?? fakePullRequests(),
    callbacks ?? fakeCallbacks(),
  );
}

describe('redactPayload', () => {
  it('removes secrets before an event is persisted', () => {
    const payload = redactPayload({
      message: 'cloning with token ghp_abcdefghijklmnopqrstuvwxyz0123',
    });
    expect(JSON.stringify(payload)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(JSON.stringify(payload)).toContain('[redacted:github_token]');
  });

  it('normalizes missing payloads to an empty object', () => {
    expect(redactPayload(undefined)).toEqual({});
    expect(redactPayload(null)).toEqual({});
  });
});

describe('statusFromPayload', () => {
  it('extracts a known run status', () => {
    expect(statusFromPayload({ status: 'verifying' })).toBe('verifying');
  });

  it('ignores unknown or missing statuses', () => {
    expect(statusFromPayload({ status: 'pushing' })).toBeNull();
    expect(statusFromPayload({})).toBeNull();
    expect(statusFromPayload('running')).toBeNull();
  });
});

describe('RunsService.applyStatus', () => {
  it('advances the run and derives the coarse task status', async () => {
    const runUpdate = vi.fn().mockResolvedValue(run({ status: 'running' }));
    const taskUpdate = vi.fn().mockResolvedValue({});
    const callbacks = fakeCallbacks();
    const svc = service(
      fakePrisma({ taskRun: { update: runUpdate }, task: { update: taskUpdate } }),
      undefined,
      callbacks,
    );

    await svc.applyStatus(run({ status: 'assigned' }), 'running');

    expect(runUpdate).toHaveBeenCalledWith({
      where: { id: 'run_1' },
      data: { status: 'running', startedAt: expect.any(Date), finishedAt: undefined },
    });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'running' },
    });
    expect(callbacks.post).toHaveBeenCalledWith('running', { runId: 'run_1' });
  });

  it('posts a failed callback with the persisted error message', async () => {
    const runUpdate = vi.fn().mockResolvedValue(run({ status: 'failed', errorMessage: 'boom' }));
    const callbacks = fakeCallbacks();
    const svc = service(
      fakePrisma({ taskRun: { update: runUpdate }, task: { update: vi.fn() } }),
      undefined,
      callbacks,
    );

    await svc.applyStatus(run({ status: 'running' }), 'failed');

    expect(callbacks.post).toHaveBeenCalledWith('failed', {
      runId: 'run_1',
      errorMessage: 'boom',
    });
  });

  it('rejects a transition that skips verifying/publishing', async () => {
    const svc = service(fakePrisma({}));
    await expect(svc.applyStatus(run({ status: 'running' }), 'succeeded')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses to move a terminal run', async () => {
    const svc = service(fakePrisma({}));
    await expect(svc.applyStatus(run({ status: 'succeeded' }), 'failed')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stamps finishedAt on a terminal transition', async () => {
    const runUpdate = vi.fn().mockResolvedValue(run({ status: 'failed' }));
    const svc = service(fakePrisma({ taskRun: { update: runUpdate }, task: { update: vi.fn() } }));

    await svc.applyStatus(run({ status: 'running', startedAt: now }), 'failed');

    expect(runUpdate.mock.calls[0][0].data.finishedAt).toBeInstanceOf(Date);
  });
});

describe('RunsService.recordEvent', () => {
  it('allocates the next per-run sequence number', async () => {
    const create = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'evt_1',
      runId: data.runId,
      seq: data.seq,
      type: data.type,
      payloadJson: data.payloadJson,
      createdAt: now,
    }));
    const svc = service(
      fakePrisma({
        runEvent: { aggregate: vi.fn().mockResolvedValue({ _max: { seq: 4 } }), create },
      }),
    );

    const event = await svc.recordEvent('run_1', 'log', { message: 'hello' });
    expect(event.seq).toBe(5);
  });

  it('retries when another writer takes the same sequence number', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
      .mockImplementation(async ({ data }) => ({
        id: 'evt_2',
        runId: data.runId,
        seq: data.seq,
        type: data.type,
        payloadJson: data.payloadJson,
        createdAt: now,
      }));
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce({ _max: { seq: 1 } })
      .mockResolvedValue({ _max: { seq: 2 } });
    const svc = service(fakePrisma({ runEvent: { aggregate, create } }));

    const event = await svc.recordEvent('run_1', 'log', {});
    expect(event.seq).toBe(3);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('RunsService.requestCancel', () => {
  it('cancels an unclaimed run immediately', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(run({ status: 'queued' }))
      .mockResolvedValueOnce(run({ status: 'queued', cancelRequestedAt: now }))
      .mockResolvedValue(run({ status: 'cancelled', cancelRequestedAt: now }));
    const update = vi.fn().mockResolvedValue(run({ status: 'cancelled' }));
    const svc = service(
      fakePrisma({
        taskRun: { findUnique, update },
        task: { update: vi.fn() },
        runEvent: {
          aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
          create: vi.fn().mockResolvedValue({
            id: 'evt',
            runId: 'run_1',
            seq: 1,
            type: 'status',
            payloadJson: {},
            createdAt: now,
          }),
        },
      }),
    );

    const dto = await svc.requestCancel('run_1');
    expect(dto.status).toBe('cancelled');
    // second update is the queued -> cancelled transition itself
    expect(update.mock.calls[1][0].data.status).toBe('cancelled');
  });

  it('only flags an in-flight run so the runner can pick it up via heartbeat', async () => {
    const update = vi.fn().mockResolvedValue(run());
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(run({ status: 'running', runnerId: 'rnr_1' }))
      .mockResolvedValue(run({ status: 'running', runnerId: 'rnr_1', cancelRequestedAt: now }));
    const svc = service(
      fakePrisma({
        taskRun: { findUnique, update },
        runEvent: {
          aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
          create: vi.fn().mockResolvedValue({
            id: 'evt',
            runId: 'run_1',
            seq: 1,
            type: 'log',
            payloadJson: {},
            createdAt: now,
          }),
        },
      }),
    );

    const dto = await svc.requestCancel('run_1');
    expect(dto.status).toBe('running');
    expect(dto.cancelRequested).toBe(true);
    expect(update.mock.calls[0][0].data.cancelRequestedAt).toBeInstanceOf(Date);
  });

  it('refuses to cancel a finished run', async () => {
    const svc = service(
      fakePrisma({
        taskRun: { findUnique: vi.fn().mockResolvedValue(run({ status: 'succeeded' })) },
      }),
    );
    await expect(svc.requestCancel('run_1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RunsService.failDisconnected', () => {
  it('fails an in-flight run with a diagnosable error when its runner disconnects', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(run({ status: 'running', runnerId: 'rnr_1' }))
      .mockResolvedValueOnce(run({ status: 'running', runnerId: 'rnr_1' }))
      .mockResolvedValue(
        run({
          status: 'failed',
          runnerId: 'rnr_1',
          errorCode: 'runner_disconnected',
          errorMessage: 'runner rnr_1 stopped sending heartbeats while this run was in flight',
        }),
      );
    const update = vi.fn().mockResolvedValue(run({ status: 'running', runnerId: 'rnr_1' }));
    const svc = service(
      fakePrisma({
        taskRun: { findUnique, update },
        task: { update: vi.fn() },
        runEvent: {
          aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
          create: vi.fn().mockResolvedValue({
            id: 'evt',
            runId: 'run_1',
            seq: 1,
            type: 'status',
            payloadJson: {},
            createdAt: now,
          }),
        },
      }),
    );

    const dto = await svc.failDisconnected('run_1', 'rnr_1');
    expect(dto.status).toBe('failed');
    expect(dto.errorCode).toBe('runner_disconnected');
    // first update call stamps the diagnosable error before the status transition
    expect(update.mock.calls[0][0].data.errorCode).toBe('runner_disconnected');
  });

  it('is a no-op once the run already finished', async () => {
    const svc = service(
      fakePrisma({
        taskRun: { findUnique: vi.fn().mockResolvedValue(run({ status: 'succeeded' })) },
      }),
    );
    const dto = await svc.failDisconnected('run_1', 'rnr_1');
    expect(dto.status).toBe('succeeded');
  });
});

describe('RunsService.retry', () => {
  it('creates a fresh queued run and leaves the failed run untouched', async () => {
    const findUnique = vi.fn().mockResolvedValue(run({ status: 'failed' }));
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi
      .fn()
      .mockResolvedValue(run({ id: 'run_2', status: 'queued', createdAt: now }));
    const taskUpdate = vi.fn().mockResolvedValue({});
    const svc = service(
      fakePrisma({
        taskRun: { findUnique, findFirst, create },
        task: { update: taskUpdate },
        runEvent: {
          aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
          create: vi.fn().mockResolvedValue({
            id: 'evt',
            runId: 'run_2',
            seq: 1,
            type: 'log',
            payloadJson: {},
            createdAt: now,
          }),
        },
      }),
    );

    const dto = await svc.retry('run_1');
    expect(dto.id).toBe('run_2');
    expect(dto.status).toBe('queued');
    expect(create).toHaveBeenCalledWith({ data: { taskId: 'task_1', executor: 'opencode' } });
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'queued' },
    });
  });

  it('refuses to retry a run that has not failed', async () => {
    const svc = service(
      fakePrisma({
        taskRun: { findUnique: vi.fn().mockResolvedValue(run({ status: 'running' })) },
      }),
    );
    await expect(svc.retry('run_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to retry while another run on the task is still active', async () => {
    const svc = service(
      fakePrisma({
        taskRun: {
          findUnique: vi.fn().mockResolvedValue(run({ status: 'failed' })),
          findFirst: vi.fn().mockResolvedValue(run({ id: 'run_3', status: 'running' })),
        },
      }),
    );
    await expect(svc.retry('run_1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RunsService.complete', () => {
  function completePrisma(overrides: Record<string, unknown> = {}) {
    const artifactCreate = vi.fn().mockResolvedValue({});
    const taskRunUpdate = vi.fn().mockResolvedValue(run({ status: 'publishing' }));
    const runEventCreate = vi.fn().mockImplementation(async ({ data }) => ({
      id: 'evt',
      runId: data.runId,
      seq: data.seq,
      type: data.type,
      payloadJson: data.payloadJson,
      createdAt: now,
    }));
    const prisma = fakePrisma({
      taskRun: {
        findUnique: vi.fn().mockResolvedValue(run({ status: 'publishing' })),
        update: taskRunUpdate,
      },
      task: {
        update: vi.fn().mockResolvedValue({}),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: 'task_1', intent: 'fix', projectId: 'proj_1' }),
      },
      project: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ id: 'proj_1', defaultBranch: 'main', evidenceRulesJson: null }),
      },
      artifact: { create: artifactCreate },
      runEvent: {
        aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
        create: runEventCreate,
      },
      ...overrides,
    });
    return { prisma, artifactCreate, taskRunUpdate };
  }

  it('persists artifacts and the terminal status as reported when no PR is needed', async () => {
    const { prisma, artifactCreate } = completePrisma();
    const openForRun = vi.fn().mockResolvedValue(null);
    const svc = service(prisma, fakePullRequests(openForRun));

    const dto = await svc.complete('run_1', {
      status: 'succeeded',
      artifacts: [{ type: 'commit', title: 'agentdock: task_1' }],
    });

    expect(dto).toBeDefined();
    expect(openForRun).not.toHaveBeenCalled();
    expect(artifactCreate).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a PR when the failure is not evidence_incomplete', async () => {
    const { prisma } = completePrisma();
    const openForRun = vi.fn().mockResolvedValue(null);
    const svc = service(prisma, fakePullRequests(openForRun));

    await svc.complete('run_1', {
      status: 'failed',
      errorCode: 'executor_failed',
      errorMessage: 'boom',
      artifacts: [],
    });

    expect(openForRun).not.toHaveBeenCalled();
  });

  it('does not attempt a PR without a pushed commit artifact', async () => {
    const { prisma } = completePrisma();
    const openForRun = vi.fn().mockResolvedValue(null);
    const svc = service(prisma, fakePullRequests(openForRun));

    await svc.complete('run_1', {
      status: 'failed',
      errorCode: 'evidence_incomplete',
      errorMessage: 'missing required evidence: pull_request',
      artifacts: [{ type: 'commit', title: 'agentdock: task_1' }],
    });

    expect(openForRun).not.toHaveBeenCalled();
  });

  it('opens a PR and flips the run to succeeded once evidence is complete', async () => {
    const { prisma, artifactCreate, taskRunUpdate } = completePrisma();
    const openForRun = vi.fn().mockResolvedValue({
      number: 42,
      url: 'https://github.com/acme/widgets/pull/42',
      title: 'Fix payment callback',
      base: 'main',
      head: 'agent/task_1-fix',
    });
    const callbacks = fakeCallbacks();
    const svc = service(prisma, fakePullRequests(openForRun), callbacks);

    const dto = await svc.complete('run_1', {
      status: 'failed',
      errorCode: 'evidence_incomplete',
      errorMessage: 'missing required evidence: pull_request',
      branch: 'agent/task_1-fix',
      artifacts: [
        { type: 'diff', title: '1 file changed' },
        { type: 'test_result', title: 'tests passed' },
        { type: 'commit', title: 'agentdock: task_1', metadata: { pushed: true } },
      ],
    });

    expect(openForRun).toHaveBeenCalledWith('run_1', 'agent/task_1-fix');
    // diff + test_result + commit + pull_request = 4 artifacts persisted
    expect(artifactCreate).toHaveBeenCalledTimes(4);
    const persistedTypes = artifactCreate.mock.calls.map(
      (call: unknown[]) => (call[0] as { data: { type: string } }).data.type,
    );
    expect(persistedTypes).toContain('pull_request');

    const runUpdateData = taskRunUpdate.mock.calls[0][0].data;
    expect(runUpdateData.errorCode).toBeNull();
    expect(runUpdateData.errorMessage).toBeNull();

    expect(callbacks.post).toHaveBeenCalledWith('pr_created', {
      runId: 'run_1',
      pullRequest: { number: 42, url: 'https://github.com/acme/widgets/pull/42' },
    });
    expect(callbacks.post).toHaveBeenCalledWith('completed', { runId: 'run_1' });

    expect(dto).toBeDefined();
  });

  it("applies the project's evidence-rule override when re-deciding after a PR", async () => {
    // fix normally needs git_changes + test_result + commit + pull_request; this
    // project drops test_result, so the run succeeds without a test artifact
    // (docs/tasks.md T8.4, #60).
    const { prisma, taskRunUpdate } = completePrisma({
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'proj_1',
          defaultBranch: 'main',
          evidenceRulesJson: { fix: ['git_changes', 'commit', 'pull_request'] },
        }),
      },
    });
    const openForRun = vi.fn().mockResolvedValue({
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      title: 'Fix payment callback',
      base: 'main',
      head: 'agent/task_1-fix',
    });
    const svc = service(prisma, fakePullRequests(openForRun));

    await svc.complete('run_1', {
      status: 'failed',
      errorCode: 'evidence_incomplete',
      errorMessage: 'missing required evidence: pull_request',
      branch: 'agent/task_1-fix',
      artifacts: [
        { type: 'diff', title: '1 file changed' },
        { type: 'commit', title: 'agentdock: task_1', metadata: { pushed: true } },
      ],
    });

    const runUpdateData = taskRunUpdate.mock.calls[0][0].data;
    expect(runUpdateData.errorCode).toBeNull();
    expect(runUpdateData.errorMessage).toBeNull();
  });

  it('keeps the run failed when a PR cannot be opened', async () => {
    const { prisma, taskRunUpdate } = completePrisma();
    const openForRun = vi.fn().mockResolvedValue(null);
    const svc = service(prisma, fakePullRequests(openForRun));

    await svc.complete('run_1', {
      status: 'failed',
      errorCode: 'evidence_incomplete',
      errorMessage: 'missing required evidence: pull_request',
      branch: 'agent/task_1-fix',
      artifacts: [{ type: 'commit', title: 'agentdock: task_1', metadata: { pushed: true } }],
    });

    expect(openForRun).toHaveBeenCalled();
    const runUpdateData = taskRunUpdate.mock.calls[0][0].data;
    expect(runUpdateData.errorCode).toBe('evidence_incomplete');
  });

  it('refuses to complete an already-terminal run', async () => {
    const prisma = fakePrisma({
      taskRun: { findUnique: vi.fn().mockResolvedValue(run({ status: 'succeeded' })) },
    });
    const svc = service(prisma);
    await expect(
      svc.complete('run_1', { status: 'succeeded', artifacts: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
