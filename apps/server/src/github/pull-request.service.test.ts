import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GitHubAppService } from './github-app.service.js';
import { PullRequestService } from './pull-request.service.js';

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any> = {}): PrismaService {
  return overrides as unknown as PrismaService;
}

function fakeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    task: {
      id: 'task_1',
      prompt: 'Fix the payment callback bug',
      project: {
        id: 'proj_1',
        defaultBranch: 'main',
        repositories: [{ id: 'repo_1', owner: 'acme', repo: 'widgets', installationId: 'inst_1' }],
      },
    },
    ...overrides,
  };
}

describe('PullRequestService.openForRun', () => {
  it('returns null without a branch', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const service = new PullRequestService(fakePrisma(), githubApp);
    expect(await service.openForRun('run_1', undefined)).toBeNull();
  });

  it('returns null when the GitHub App is not configured', async () => {
    const githubApp = { isConfigured: () => false } as unknown as GitHubAppService;
    const service = new PullRequestService(fakePrisma(), githubApp);
    expect(await service.openForRun('run_1', 'agent/task_1-fix')).toBeNull();
  });

  it('returns null when the run cannot be found', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new PullRequestService(prisma, githubApp);
    expect(await service.openForRun('run_1', 'agent/task_1-fix')).toBeNull();
  });

  it('returns null when the project has no bound repository', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const run = fakeRun({
      task: { id: 'task_1', prompt: 'p', project: { defaultBranch: 'main', repositories: [] } },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new PullRequestService(prisma, githubApp);
    expect(await service.openForRun('run_1', 'agent/task_1-fix')).toBeNull();
  });

  it('returns null when the project has more than one bound repository (ambiguous)', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        prompt: 'p',
        project: {
          defaultBranch: 'main',
          repositories: [
            { owner: 'acme', repo: 'a', installationId: 'i1' },
            { owner: 'acme', repo: 'b', installationId: 'i2' },
          ],
        },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new PullRequestService(prisma, githubApp);
    expect(await service.openForRun('run_1', 'agent/task_1-fix')).toBeNull();
  });

  it('returns null when the bound repository has no installationId', async () => {
    const githubApp = { isConfigured: () => true } as unknown as GitHubAppService;
    const run = fakeRun({
      task: {
        id: 'task_1',
        prompt: 'p',
        project: {
          defaultBranch: 'main',
          repositories: [{ owner: 'acme', repo: 'widgets', installationId: null }],
        },
      },
    });
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new PullRequestService(prisma, githubApp);
    expect(await service.openForRun('run_1', 'agent/task_1-fix')).toBeNull();
  });

  it('opens a PR against the bound repository using the project default branch as base', async () => {
    const createPullRequest = vi.fn().mockResolvedValue({
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      title: 'Fix the payment callback bug',
    });
    const githubApp = {
      isConfigured: () => true,
      createPullRequest,
    } as unknown as GitHubAppService;
    const run = fakeRun();
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new PullRequestService(prisma, githubApp);

    const result = await service.openForRun('run_1', 'agent/task_1-fix');

    expect(result).toEqual({
      number: 7,
      url: 'https://github.com/acme/widgets/pull/7',
      title: 'Fix the payment callback bug',
      base: 'main',
      head: 'agent/task_1-fix',
    });
    expect(createPullRequest).toHaveBeenCalledWith('inst_1', {
      owner: 'acme',
      repo: 'widgets',
      title: 'Fix the payment callback bug',
      body: expect.stringContaining('task_1'),
      base: 'main',
      head: 'agent/task_1-fix',
    });
  });

  it('returns null (without throwing) when the GitHub API call fails', async () => {
    const createPullRequest = vi.fn().mockRejectedValue(new Error('network error'));
    const githubApp = {
      isConfigured: () => true,
      createPullRequest,
    } as unknown as GitHubAppService;
    const run = fakeRun();
    const prisma = fakePrisma({ taskRun: { findUnique: vi.fn().mockResolvedValue(run) } });
    const service = new PullRequestService(prisma, githubApp);

    await expect(service.openForRun('run_1', 'agent/task_1-fix')).resolves.toBeNull();
  });
});
