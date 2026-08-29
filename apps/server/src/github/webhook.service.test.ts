import { createHmac } from 'node:crypto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Task } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TasksService } from '../tasks/tasks.service.js';
import type { GitHubWebhookHeaders } from './webhook.dto.js';
import { GitHubWebhookService } from './webhook.service.js';

const secret = 'test-webhook-secret';

function config(overrides: Partial<ServerConfig['github']> = {}): ServerConfig {
  return {
    databaseUrl: 'mysql://x',
    port: 3100,
    apiAuthToken: 'a'.repeat(20),
    runnerToken: 'b'.repeat(20),
    github: { webhookSecret: secret, ...overrides },
  } as ServerConfig;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any> = {}): PrismaService {
  return {
    task: { findUnique: vi.fn().mockResolvedValue(null) },
    repository: { findUnique: vi.fn().mockResolvedValue({ projectId: 'proj_1' }) },
    ...overrides,
  } as unknown as PrismaService;
}

function fakeTasks(overrides: Partial<TasksService> = {}): TasksService {
  return {
    create: vi.fn().mockResolvedValue({
      task: { id: 'task_1' } as Task,
      deduplicated: false,
    }),
    ...overrides,
  } as unknown as TasksService;
}

function sign(body: string, withSecret = secret): string {
  return `sha256=${createHmac('sha256', withSecret).update(body).digest('hex')}`;
}

const mentionCommentPayload = {
  action: 'created',
  repository: { full_name: 'bao/agentdock' },
  issue: { number: 7 },
  comment: { id: 42, body: '@agent fix the duplicate callback', user: { login: 'alice' } },
};

function headersFor(
  body: string,
  event = 'issue_comment',
  deliveryId = 'delivery-1',
): GitHubWebhookHeaders {
  return { signature256: sign(body), event, deliveryId };
}

describe('GitHubWebhookService.handle', () => {
  it('rejects when the webhook secret is not configured', async () => {
    const service = new GitHubWebhookService(
      config({ webhookSecret: undefined }),
      fakePrisma(),
      fakeTasks(),
    );
    await expect(
      service.handle(Buffer.from('{}'), { event: 'issue_comment' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a missing raw body', async () => {
    const service = new GitHubWebhookService(config(), fakePrisma(), fakeTasks());
    await expect(
      service.handle(undefined, { event: 'issue_comment', signature256: sign('{}') }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid signature', async () => {
    const service = new GitHubWebhookService(config(), fakePrisma(), fakeTasks());
    const body = JSON.stringify(mentionCommentPayload);
    await expect(
      service.handle(
        Buffer.from(body),
        { event: 'issue_comment', signature256: 'sha256=wrong' },
        mentionCommentPayload,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ignores an unsupported event with a valid signature (e.g. ping)', async () => {
    const service = new GitHubWebhookService(config(), fakePrisma(), fakeTasks());
    const body = JSON.stringify({ zen: 'hello' });
    const result = await service.handle(
      Buffer.from(body),
      { event: 'ping', signature256: sign(body), deliveryId: 'd-ping' },
      { zen: 'hello' },
    );
    expect(result).toEqual({ status: 'ignored', reason: 'unsupported event: ping' });
  });

  it('short-circuits on a previously seen delivery id before touching the payload', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'task_existing' });
    const prisma = fakePrisma({ task: { findUnique } });
    const tasks = fakeTasks();
    const service = new GitHubWebhookService(config(), prisma, tasks);

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(result).toEqual({ status: 'deduplicated', taskId: 'task_existing' });
    expect(findUnique).toHaveBeenCalledWith({ where: { deliveryId: 'delivery-1' } });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('ignores events for repositories with no bound project', async () => {
    const prisma = fakePrisma({ repository: { findUnique: vi.fn().mockResolvedValue(null) } });
    const tasks = fakeTasks();
    const service = new GitHubWebhookService(config(), prisma, tasks);

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(result.status).toBe('ignored');
    expect(result.reason).toContain('bao/agentdock');
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('ignores a payload without an actionable mention', async () => {
    const payload = {
      ...mentionCommentPayload,
      comment: { id: 42, body: 'just chatting', user: { login: 'alice' } },
    };
    const tasks = fakeTasks();
    const service = new GitHubWebhookService(config(), fakePrisma(), tasks);

    const body = JSON.stringify(payload);
    const result = await service.handle(Buffer.from(body), headersFor(body), payload);

    expect(result).toEqual({ status: 'ignored', reason: 'no actionable mention found' });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('enforces the actor allowlist from config', async () => {
    const tasks = fakeTasks();
    const service = new GitHubWebhookService(
      config({ actorAllowlist: ['someone-else'] }),
      fakePrisma(),
      tasks,
    );

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(result.status).toBe('ignored');
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('creates a task from a valid, verified, novel delivery', async () => {
    const tasks = fakeTasks();
    const service = new GitHubWebhookService(config(), fakePrisma(), tasks);

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(tasks.create).toHaveBeenCalledWith({
      projectId: 'proj_1',
      source: 'github',
      sourceRef: 'github:bao/agentdock:issue_comment#42',
      deliveryId: 'delivery-1',
      intent: 'fix',
      prompt: 'fix the duplicate callback',
      createdBy: 'alice',
    });
    expect(result).toEqual({ status: 'accepted', taskId: 'task_1' });
  });

  it('reports deduplication when TasksService resolves the dedupe key itself', async () => {
    const tasks = fakeTasks({
      create: vi.fn().mockResolvedValue({ task: { id: 'task_1' }, deduplicated: true }),
    });
    const service = new GitHubWebhookService(config(), fakePrisma(), tasks);

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(result).toEqual({ status: 'deduplicated', taskId: 'task_1' });
  });

  it('treats a race-lost unique constraint error as deduplicated', async () => {
    const tasks = fakeTasks({
      create: vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
    });
    const service = new GitHubWebhookService(config(), fakePrisma(), tasks);

    const body = JSON.stringify(mentionCommentPayload);
    const result = await service.handle(Buffer.from(body), headersFor(body), mentionCommentPayload);

    expect(result.status).toBe('deduplicated');
  });
});
