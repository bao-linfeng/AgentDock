import type { Runner, TaskRun } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RunsService } from '../runs/runs.service.js';
import { RunnerDisconnectSweeper } from './runner-disconnect.sweeper.js';
import type { RunnersService } from './runners.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function runner(overrides: Partial<Runner> = {}): Runner {
  return {
    id: 'rnr_1',
    name: 'dev-box',
    machineName: null,
    platform: null,
    version: null,
    status: 'online',
    tokenHash: 'hash',
    revoked: false,
    revokedAt: null,
    lastHeartbeatAt: now,
    createdAt: now,
    ...overrides,
  } as Runner;
}

function orphanedRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    runnerId: 'rnr_1',
    executor: 'opencode',
    status: 'running',
    branch: null,
    worktreePath: null,
    startedAt: now,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TaskRun;
}

describe('RunnerDisconnectSweeper.run', () => {
  it('fails every in-flight run owned by a stale runner and marks it offline', async () => {
    const stale = runner({ id: 'rnr_stale' });
    const findStaleOnlineRunners = vi.fn().mockResolvedValue([stale]);
    const markOffline = vi.fn().mockResolvedValue(undefined);
    const failDisconnected = vi.fn().mockResolvedValue({});
    const findMany = vi.fn().mockResolvedValue([orphanedRun({ runnerId: 'rnr_stale' })]);

    const sweeper = new RunnerDisconnectSweeper(
      { findStaleOnlineRunners, markOffline } as unknown as RunnersService,
      { failDisconnected } as unknown as RunsService,
      { taskRun: { findMany } } as unknown as PrismaService,
    );

    await sweeper.run(now);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        runnerId: 'rnr_stale',
        status: { in: ['assigned', 'running', 'needs_approval', 'verifying', 'publishing'] },
      },
    });
    expect(failDisconnected).toHaveBeenCalledWith('run_1', 'rnr_stale');
    expect(markOffline).toHaveBeenCalledWith('rnr_stale');
  });

  it('marks a stale idle runner offline without touching any run', async () => {
    const stale = runner({ id: 'rnr_idle' });
    const findStaleOnlineRunners = vi.fn().mockResolvedValue([stale]);
    const markOffline = vi.fn().mockResolvedValue(undefined);
    const failDisconnected = vi.fn();
    const findMany = vi.fn().mockResolvedValue([]);

    const sweeper = new RunnerDisconnectSweeper(
      { findStaleOnlineRunners, markOffline } as unknown as RunnersService,
      { failDisconnected } as unknown as RunsService,
      { taskRun: { findMany } } as unknown as PrismaService,
    );

    await sweeper.run(now);

    expect(failDisconnected).not.toHaveBeenCalled();
    expect(markOffline).toHaveBeenCalledWith('rnr_idle');
  });

  it('does nothing when no runner is stale', async () => {
    const findStaleOnlineRunners = vi.fn().mockResolvedValue([]);
    const markOffline = vi.fn();
    const sweeper = new RunnerDisconnectSweeper(
      { findStaleOnlineRunners, markOffline } as unknown as RunnersService,
      {} as unknown as RunsService,
      {} as unknown as PrismaService,
    );

    await sweeper.run(now);
    expect(markOffline).not.toHaveBeenCalled();
  });
});
