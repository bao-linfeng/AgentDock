import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuditService, auditPromptExcerpt, redactAuditDetail } from './audit.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(auditLog: Record<string, any>): PrismaService {
  return { auditLog } as unknown as PrismaService;
}

describe('auditPromptExcerpt', () => {
  it('keeps short prompts intact', () => {
    expect(auditPromptExcerpt('fix the bug')).toBe('fix the bug');
  });

  it('truncates long prompts', () => {
    const excerpt = auditPromptExcerpt('x'.repeat(600));
    expect(excerpt.length).toBe(501);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('redactAuditDetail', () => {
  it('redacts secrets in structured detail', () => {
    const detail = redactAuditDetail({ prompt: 'use ghp_0123456789abcdef0123456789abcdef0123' });
    expect(JSON.stringify(detail)).not.toContain('ghp_0123456789abcdef0123456789abcdef0123');
  });

  it('returns undefined without detail', () => {
    expect(redactAuditDetail(undefined)).toBeUndefined();
  });
});

describe('AuditService.record', () => {
  it('persists an entry with redacted detail', async () => {
    const create = vi.fn().mockResolvedValue({});
    const service = new AuditService(fakePrisma({ create }));

    await service.record({
      action: 'task_created',
      source: 'github',
      actor: 'alice',
      projectId: 'proj_1',
      taskId: 'task_1',
      runId: 'run_1',
      detail: { intent: 'fix', prompt: 'fix the callback' },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.action).toBe('task_created');
    expect(data.source).toBe('github');
    expect(data.actor).toBe('alice');
    expect(data.taskId).toBe('task_1');
    expect(data.detailJson).toEqual({ intent: 'fix', prompt: 'fix the callback' });
  });

  it('never throws when the write fails (audit must not break the action)', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    const service = new AuditService(fakePrisma({ create }));

    await expect(
      service.record({ action: 'run_completed', source: 'runner', runId: 'run_1' }),
    ).resolves.toBeUndefined();
  });
});

describe('AuditService.list', () => {
  it('filters and paginates, newest first', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'aud_1',
        action: 'run_completed',
        source: 'runner',
        actor: 'dev-box',
        projectId: null,
        taskId: 'task_1',
        runId: 'run_1',
        detailJson: { status: 'succeeded' },
        createdAt: now,
      },
    ]);
    const service = new AuditService(fakePrisma({ findMany }));

    const rows = await service.list({ runId: 'run_1', limit: 10, offset: 5 });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        action: undefined,
        source: undefined,
        taskId: undefined,
        runId: 'run_1',
        projectId: undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      skip: 5,
    });
    expect(rows).toEqual([
      {
        id: 'aud_1',
        action: 'run_completed',
        source: 'runner',
        actor: 'dev-box',
        projectId: undefined,
        taskId: 'task_1',
        runId: 'run_1',
        detail: { status: 'succeeded' },
        createdAt: now.toISOString(),
      },
    ]);
  });
});
