import { RUNNER_OFFLINE_TIMEOUT_MS } from '@agentdock/shared';
import { UnauthorizedException } from '@nestjs/common';
import type { Runner } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import { hashToken } from '../auth/token.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { RunnersService, isRunnerOnline, toRunnerDto } from './runners.service.js';

/** Audit writes are best-effort side effects; stub them out (docs/tasks.md T9.5). */
function fakeAudit(): AuditService {
  return { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

const now = new Date('2026-01-01T00:00:00.000Z');

function runner(overrides: Partial<Runner> = {}): Runner {
  return {
    id: 'rnr_1',
    name: 'dev-box',
    machineName: 'WIN-DEV',
    platform: 'win32',
    version: '0.0.0',
    status: 'online',
    tokenHash: hashToken('runner-token'),
    revoked: false,
    revokedAt: null,
    lastHeartbeatAt: now,
    createdAt: now,
    ...overrides,
  } as Runner;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any>): PrismaService {
  return overrides as unknown as PrismaService;
}

describe('isRunnerOnline', () => {
  it('is online within the heartbeat timeout', () => {
    const at = new Date(now.getTime() + RUNNER_OFFLINE_TIMEOUT_MS - 1);
    expect(isRunnerOnline(runner(), at)).toBe(true);
  });

  it('goes offline once the heartbeat is stale', () => {
    const at = new Date(now.getTime() + RUNNER_OFFLINE_TIMEOUT_MS + 1);
    expect(isRunnerOnline(runner(), at)).toBe(false);
  });

  it('is never online without a heartbeat or when revoked', () => {
    expect(isRunnerOnline(runner({ lastHeartbeatAt: null }), now)).toBe(false);
    expect(isRunnerOnline(runner({ revoked: true }), now)).toBe(false);
  });
});

describe('toRunnerDto', () => {
  it('never exposes the token hash', () => {
    const dto = toRunnerDto(runner(), now) as unknown as Record<string, unknown>;
    expect(dto.tokenHash).toBeUndefined();
    expect(dto.status).toBe('online');
  });
});

describe('RunnersService.register', () => {
  it('upserts the runner by token hash and marks it online', async () => {
    const upsert = vi.fn().mockResolvedValue(runner());
    const service = new RunnersService(
      fakePrisma({ runner: { findUnique: vi.fn().mockResolvedValue(null), upsert } }),
      fakeAudit(),
    );

    const dto = await service.register('runner-token', { name: 'dev-box', platform: 'win32' });

    expect(upsert.mock.calls[0][0].where).toEqual({ tokenHash: hashToken('runner-token') });
    expect(upsert.mock.calls[0][0].create.status).toBe('online');
    expect(dto.id).toBe('rnr_1');
  });

  it('rejects a revoked token', async () => {
    const service = new RunnersService(
      fakePrisma({
        runner: {
          findUnique: vi.fn().mockResolvedValue(runner({ revoked: true })),
          upsert: vi.fn(),
        },
      }),
      fakeAudit(),
    );
    await expect(service.register('runner-token', { name: 'dev-box' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('RunnersService.upsertProject', () => {
  it('requires the project to exist before mapping a workspace path', async () => {
    const service = new RunnersService(
      fakePrisma({
        runner: { findUnique: vi.fn().mockResolvedValue(runner()) },
        project: { findUnique: vi.fn().mockResolvedValue(null) },
      }),
      fakeAudit(),
    );
    await expect(
      service.upsertProject('rnr_1', 'missing', { workspacePath: 'D:/repo', enabled: true }),
    ).rejects.toThrow(/unknown project/);
  });
});

describe('RunnersService.findStaleOnlineRunners', () => {
  it('returns only online runners whose heartbeat has gone stale', async () => {
    const fresh = runner({ id: 'rnr_fresh', lastHeartbeatAt: now });
    const stale = runner({
      id: 'rnr_stale',
      lastHeartbeatAt: new Date(now.getTime() - RUNNER_OFFLINE_TIMEOUT_MS - 1),
    });
    const service = new RunnersService(
      fakePrisma({ runner: { findMany: vi.fn().mockResolvedValue([fresh, stale]) } }),
      fakeAudit(),
    );

    const result = await service.findStaleOnlineRunners(now);
    expect(result).toEqual([stale]);
  });
});

describe('RunnersService.markOffline', () => {
  it('flips the stored status to offline', async () => {
    const update = vi.fn().mockResolvedValue(runner({ status: 'offline' }));
    const service = new RunnersService(fakePrisma({ runner: { update } }), fakeAudit());

    await service.markOffline('rnr_1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'rnr_1' }, data: { status: 'offline' } });
  });
});
