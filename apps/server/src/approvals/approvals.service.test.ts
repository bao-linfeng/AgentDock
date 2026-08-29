import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Approval } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { RunEventsBus } from '../events/run-events.bus.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ApprovalsService } from './approvals.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'app_1',
    runId: 'run_1',
    action: 'shell',
    status: 'pending',
    summary: null,
    detailJson: null,
    requestedAt: now,
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  } as Approval;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any>): PrismaService {
  const defaults = {
    runEvent: {
      aggregate: vi.fn().mockResolvedValue({ _max: { seq: 0 } }),
      create: vi.fn().mockResolvedValue({
        id: 'evt_1',
        runId: 'run_1',
        seq: 1,
        type: 'approval',
        payloadJson: {},
        createdAt: now,
      }),
    },
    taskRun: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'run_1' }) },
  };
  return { ...defaults, ...overrides } as unknown as PrismaService;
}

describe('ApprovalsService.request', () => {
  it('creates a pending approval and publishes a run event', async () => {
    const create = vi.fn().mockResolvedValue(approval());
    const bus = new RunEventsBus();
    const publish = vi.spyOn(bus, 'publish');
    const service = new ApprovalsService(fakePrisma({ approval: { create } }), bus);

    const result = await service.request('run_1', {
      action: 'shell',
      summary: 'run `pnpm build`',
    });

    expect(create).toHaveBeenCalledWith({
      data: { runId: 'run_1', action: 'shell', summary: 'run `pnpm build`', detailJson: undefined },
    });
    expect(result).toEqual(
      expect.objectContaining({ id: 'app_1', action: 'shell', status: 'pending' }),
    );
    expect(publish).toHaveBeenCalled();
  });

  it('redacts secrets embedded in the detail payload before persisting', async () => {
    const create = vi.fn().mockResolvedValue(approval());
    const service = new ApprovalsService(fakePrisma({ approval: { create } }), new RunEventsBus());

    await service.request('run_1', {
      action: 'push',
      detail: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
    });

    const data = create.mock.calls[0]?.[0]?.data;
    expect(JSON.stringify(data.detailJson)).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    );
  });
});

describe('ApprovalsService.resolve', () => {
  it('resolves a pending approval and records who resolved it', async () => {
    const findUnique = vi.fn().mockResolvedValue(approval());
    const update = vi
      .fn()
      .mockResolvedValue(approval({ status: 'approved', resolvedAt: now, resolvedBy: 'web' }));
    const service = new ApprovalsService(
      fakePrisma({ approval: { findUnique, update } }),
      new RunEventsBus(),
    );

    const result = await service.resolve('app_1', { decision: 'approved', resolvedBy: 'web' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'app_1' },
      data: { status: 'approved', resolvedAt: expect.any(Date), resolvedBy: 'web' },
    });
    expect(result.status).toBe('approved');
  });

  it('rejects resolving an approval twice', async () => {
    const findUnique = vi.fn().mockResolvedValue(approval({ status: 'approved' }));
    const service = new ApprovalsService(
      fakePrisma({ approval: { findUnique, update: vi.fn() } }),
      new RunEventsBus(),
    );

    await expect(service.resolve('app_1', { decision: 'denied' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFoundException for an unknown approval id', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = new ApprovalsService(
      fakePrisma({ approval: { findUnique } }),
      new RunEventsBus(),
    );

    await expect(service.resolve('missing', { decision: 'approved' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ApprovalsService.pendingForRun', () => {
  it('returns the oldest pending approval for a run', async () => {
    const findFirst = vi.fn().mockResolvedValue(approval());
    const service = new ApprovalsService(
      fakePrisma({ approval: { findFirst } }),
      new RunEventsBus(),
    );

    const result = await service.pendingForRun('run_1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { runId: 'run_1', status: 'pending' },
      orderBy: { requestedAt: 'asc' },
    });
    expect(result?.id).toBe('app_1');
  });

  it('returns null when there is nothing pending', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ApprovalsService(
      fakePrisma({ approval: { findFirst } }),
      new RunEventsBus(),
    );
    expect(await service.pendingForRun('run_1')).toBeNull();
  });
});
