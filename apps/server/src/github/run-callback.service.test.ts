import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GitHubAppService } from './github-app.service.js';
import { RunCallbackService } from './run-callback.service.js';

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any> = {}): PrismaService {
  return overrides as unknown as PrismaService;
}

function fakeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    task: {
      id: 'task_1',
      callbackRepo: 'acme/widgets',
      callbackIssueNumber: 7,
      project: {
        id: 'proj_1',
        repositories: [{ id: 'repo_1', owner: 'acme', repo: 'widgets', installationId: 'inst_1' }],
      },
    },
    ...overrides,
  };
}

describe('RunCallbackService.post', () => {
  it('does nothing when the GitHub App is not configured', async () => {
    const githubApp = { isConfigured: () => false } as unknown as GitHubAppService;
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn() } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(prisma.taskRun.findUnique).not.toHaveBeenCalled();
  });

  it('does nothing when the run cannot be found', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });
    // no throw is the assertion here
  });

  it('does nothing when the task has no callback target (e.g. source: web)', async () => {
    const githubApp = {
      isConfigured: () => true,
      createIssueComment: vi.fn(),
    } as unknown as GitHubAppService;
    const run = fakeRun({
      task: { id: 'task_1', callbackRepo: null, callbackIssueNumber: null, project: {} },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(githubApp.createIssueComment).not.toHaveBeenCalled();
  });

  it('does nothing when the project has no bound repositories', async () => {
    const githubApp = {
      isConfigured: () => true,
      createIssueComment: vi.fn(),
    } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        callbackRepo: 'acme/widgets',
        callbackIssueNumber: 7,
        project: { repositories: [] },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(githubApp.createIssueComment).not.toHaveBeenCalled();
  });

  it('does nothing when callbackRepo does not match any bound repository', async () => {
    const githubApp = {
      isConfigured: () => true,
      createIssueComment: vi.fn(),
    } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        callbackRepo: 'acme/unbound',
        callbackIssueNumber: 7,
        project: { repositories: [{ owner: 'acme', repo: 'widgets', installationId: 'i1' }] },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(githubApp.createIssueComment).not.toHaveBeenCalled();
  });

  it('posts to the repository named by callbackRepo when the project has multiple bound repositories (#51)', async () => {
    const createIssueComment = vi.fn().mockResolvedValue({ id: 1, url: 'https://x' });
    const githubApp = {
      isConfigured: () => true,
      createIssueComment,
    } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        callbackRepo: 'acme/backend',
        callbackIssueNumber: 7,
        project: {
          repositories: [
            { owner: 'acme', repo: 'frontend', installationId: 'i1' },
            { owner: 'acme', repo: 'backend', installationId: 'i2' },
          ],
        },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(createIssueComment).toHaveBeenCalledWith('i2', {
      owner: 'acme',
      repo: 'backend',
      issueNumber: 7,
      body: expect.stringContaining('run_1'),
    });
  });

  it('does nothing when the bound repository has no installationId', async () => {
    const githubApp = {
      isConfigured: () => true,
      createIssueComment: vi.fn(),
    } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        callbackRepo: 'acme/widgets',
        callbackIssueNumber: 7,
        project: { repositories: [{ owner: 'acme', repo: 'widgets', installationId: null }] },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(githubApp.createIssueComment).not.toHaveBeenCalled();
  });

  it('posts a comment on the originating issue/PR thread', async () => {
    const createIssueComment = vi.fn().mockResolvedValue({ id: 1, url: 'https://x' });
    const githubApp = {
      isConfigured: () => true,
      createIssueComment,
    } as unknown as GitHubAppService;
    const run = fakeRun();
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('picked_up', { runId: 'run_1' });

    expect(createIssueComment).toHaveBeenCalledWith('inst_1', {
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 7,
      body: expect.stringContaining('run_1'),
    });
  });

  it('includes the PR link in the pr_created comment', async () => {
    const createIssueComment = vi.fn().mockResolvedValue({ id: 1, url: 'https://x' });
    const githubApp = {
      isConfigured: () => true,
      createIssueComment,
    } as unknown as GitHubAppService;
    const run = fakeRun();
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await service.post('pr_created', {
      runId: 'run_1',
      pullRequest: { number: 42, url: 'https://github.com/acme/widgets/pull/42' },
    });

    const body = createIssueComment.mock.calls[0][1].body as string;
    expect(body).toContain('https://github.com/acme/widgets/pull/42');
  });

  it('swallows errors from the GitHub API without throwing', async () => {
    const createIssueComment = vi.fn().mockRejectedValue(new Error('network error'));
    const githubApp = {
      isConfigured: () => true,
      createIssueComment,
    } as unknown as GitHubAppService;
    const run = fakeRun();
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new RunCallbackService(prisma, githubApp);

    await expect(service.post('picked_up', { runId: 'run_1' })).resolves.toBeUndefined();
  });
});
