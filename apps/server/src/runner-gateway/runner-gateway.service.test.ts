import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Runner, TaskRun } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RunnersService } from '../runners/runners.service.js';
import type { RunsService } from '../runs/runs.service.js';
import { RunnerGatewayService } from './runner-gateway.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

const runner = { id: 'rnr_1', name: 'dev-box', revoked: false } as Runner;

function queuedRun(id: string, overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id,
    taskId: `task_${id}`,
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

function claimableRun(id: string) {
  return {
    ...queuedRun(id, { status: 'assigned', runnerId: 'rnr_1' }),
    task: {
      id: `task_${id}`,
      intent: 'fix',
      source: 'web',
      sourceRef: null,
      prompt: 'fix the bug',
      projectId: 'proj_1',
      project: {
        id: 'proj_1',
        name: 'PaymentService',
        workspaceKey: 'payment-service',
        defaultBranch: 'main',
        testCommand: 'pnpm test',
        buildCommand: null,
      },
    },
  };
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural stubs
function build(prisma: Record<string, any>, runs: Record<string, any> = {}) {
  const recordEvent = vi.fn().mockResolvedValue({});
  const runsStub = { recordEvent, ...runs } as unknown as RunsService;
  const runnersStub = {
    touchHeartbeat: vi.fn().mockResolvedValue(undefined),
  } as unknown as RunnersService;
  const service = new RunnerGatewayService(
    prisma as unknown as PrismaService,
    runsStub,
    runnersStub,
  );
  return { service, recordEvent, runnersStub };
}

describe('RunnerGatewayService.requireRegistered', () => {
  it('rejects a token that has not registered a runner yet', () => {
    const { service } = build({});
    expect(() => service.requireRegistered(null)).toThrow(UnauthorizedException);
    expect(service.requireRegistered(runner)).toBe(runner);
  });
});

describe('RunnerGatewayService.claim', () => {
  it('claims nothing when the runner has no project mapping', async () => {
    const { service } = build({ runnerProject: { findMany: vi.fn().mockResolvedValue([]) } });
    await expect(service.claim(runner)).resolves.toEqual({ claimed: false });
  });

  it('claims nothing while another run is in flight (one task at a time)', async () => {
    const { service } = build({
      runnerProject: {
        findMany: vi.fn().mockResolvedValue([{ projectId: 'proj_1', workspacePath: 'D:/repo' }]),
      },
      taskRun: { count: vi.fn().mockResolvedValue(1) },
    });
    await expect(service.claim(runner)).resolves.toEqual({ claimed: false });
  });

  it('atomically assigns the oldest queued run and returns the local workspace path', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { service, recordEvent } = build({
      runnerProject: {
        findMany: vi.fn().mockResolvedValue([{ projectId: 'proj_1', workspacePath: 'D:/repo' }]),
      },
      taskRun: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([queuedRun('run_1')]),
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue(claimableRun('run_1')),
      },
    });

    const result = await service.claim(runner);

    // The conditional UPDATE is what makes the claim atomic.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'run_1', status: 'queued', runnerId: null },
      data: { status: 'assigned', runnerId: 'rnr_1' },
    });
    expect(result.claimed).toBe(true);
    expect(result.work?.project.workspacePath).toBe('D:/repo');
    expect(result.work?.project.testCommand).toBe('pnpm test');
    expect(result.work?.task.prompt).toBe('fix the bug');
    expect(result.work?.run.status).toBe('assigned');
    expect(recordEvent).toHaveBeenCalledWith('run_1', 'status', {
      status: 'assigned',
      runnerId: 'rnr_1',
      runnerName: 'dev-box',
    });
  });

  it('skips a run that another claim already took and tries the next candidate', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const { service } = build({
      runnerProject: {
        findMany: vi.fn().mockResolvedValue([{ projectId: 'proj_1', workspacePath: 'D:/repo' }]),
      },
      taskRun: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([queuedRun('run_1'), queuedRun('run_2')]),
        updateMany,
        findUniqueOrThrow: vi.fn().mockResolvedValue(claimableRun('run_2')),
      },
    });

    const result = await service.claim(runner);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(result.work?.run.id).toBe('run_2');
  });
});

describe('RunnerGatewayService run ownership', () => {
  it('forbids reporting events on a run owned by another runner', async () => {
    const { service } = build(
      {},
      { requireRun: vi.fn().mockResolvedValue(queuedRun('run_9', { runnerId: 'rnr_other' })) },
    );
    await expect(
      service.appendEvent(runner, 'run_9', { type: 'log', payload: {} }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('RunnerGatewayService.runHeartbeat', () => {
  it('returns the cancellation flag so the runner can stop the executor', async () => {
    const { service } = build(
      {},
      {
        requireRun: vi.fn().mockResolvedValue(
          queuedRun('run_1', {
            status: 'running',
            runnerId: 'rnr_1',
            cancelRequestedAt: now,
          }),
        ),
      },
    );

    await expect(service.runHeartbeat(runner, 'run_1')).resolves.toEqual({
      runId: 'run_1',
      status: 'running',
      cancelRequested: true,
    });
  });

  it('reports no cancellation for a healthy run', async () => {
    const { service } = build(
      {},
      {
        requireRun: vi
          .fn()
          .mockResolvedValue(queuedRun('run_1', { status: 'running', runnerId: 'rnr_1' })),
      },
    );
    const response = await service.runHeartbeat(runner, 'run_1');
    expect(response.cancelRequested).toBe(false);
  });
});

describe('RunnerGatewayService.runnerHeartbeat', () => {
  it('lists in-flight runs with their cancellation flags', async () => {
    const { service, runnersStub } = build({
      taskRun: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            queuedRun('run_1', { status: 'running', runnerId: 'rnr_1', cancelRequestedAt: now }),
          ]),
      },
    });

    const response = await service.runnerHeartbeat(runner);
    expect(runnersStub.touchHeartbeat).toHaveBeenCalledWith('rnr_1');
    expect(response.activeRuns).toEqual([
      { runId: 'run_1', status: 'running', cancelRequested: true },
    ]);
  });
});
