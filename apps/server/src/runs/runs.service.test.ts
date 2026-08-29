import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TaskRun } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RunEventsBus } from '../events/run-events.bus.js';
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

function service(prisma: PrismaService): RunsService {
  return new RunsService(prisma, new RunEventsBus());
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
    const svc = service(
      fakePrisma({ taskRun: { update: runUpdate }, task: { update: taskUpdate } }),
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
