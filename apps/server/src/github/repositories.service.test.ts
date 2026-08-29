import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Repository } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ProjectsService } from '../projects/projects.service.js';
import type { GitHubAppService } from './github-app.service.js';
import { RepositoriesService } from './repositories.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 'repo_1',
    projectId: 'proj_1',
    provider: 'github',
    owner: 'acme',
    repo: 'payment-service',
    installationId: '123',
    createdAt: now,
    ...overrides,
  } as Repository;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any>): PrismaService {
  return overrides as unknown as PrismaService;
}

function fakeProjects(): ProjectsService {
  return {
    requireProject: vi.fn().mockResolvedValue({ id: 'proj_1' }),
  } as unknown as ProjectsService;
}

function fakeGitHubApp(accessible: { owner: string; repo: string }[]): GitHubAppService {
  return {
    listInstallationRepositories: vi.fn().mockResolvedValue(accessible),
  } as unknown as GitHubAppService;
}

const uniqueViolation = Object.assign(new Error('unique'), { code: 'P2002' });

describe('RepositoriesService.bind', () => {
  it('binds when the installation has access to owner/repo', async () => {
    const create = vi.fn().mockResolvedValue(repository());
    const service = new RepositoriesService(
      fakePrisma({ repository: { create } }),
      fakeProjects(),
      fakeGitHubApp([{ owner: 'acme', repo: 'payment-service' }]),
    );

    const dto = await service.bind('proj_1', {
      provider: 'github',
      owner: 'acme',
      repo: 'payment-service',
      installationId: '123',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: 'proj_1',
        provider: 'github',
        owner: 'acme',
        repo: 'payment-service',
        installationId: '123',
      },
    });
    expect(dto).toMatchObject({ id: 'repo_1', owner: 'acme', repo: 'payment-service' });
  });

  it('is case-insensitive when matching owner/repo against the installation list', async () => {
    const create = vi.fn().mockResolvedValue(repository());
    const service = new RepositoriesService(
      fakePrisma({ repository: { create } }),
      fakeProjects(),
      fakeGitHubApp([{ owner: 'Acme', repo: 'Payment-Service' }]),
    );

    await expect(
      service.bind('proj_1', {
        provider: 'github',
        owner: 'acme',
        repo: 'payment-service',
        installationId: '123',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects when the installation cannot see the repository', async () => {
    const service = new RepositoriesService(
      fakePrisma({ repository: { create: vi.fn() } }),
      fakeProjects(),
      fakeGitHubApp([{ owner: 'acme', repo: 'other-repo' }]),
    );

    await expect(
      service.bind('proj_1', {
        provider: 'github',
        owner: 'acme',
        repo: 'payment-service',
        installationId: '123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate binding to 409', async () => {
    const service = new RepositoriesService(
      fakePrisma({ repository: { create: vi.fn().mockRejectedValue(uniqueViolation) } }),
      fakeProjects(),
      fakeGitHubApp([{ owner: 'acme', repo: 'payment-service' }]),
    );

    await expect(
      service.bind('proj_1', {
        provider: 'github',
        owner: 'acme',
        repo: 'payment-service',
        installationId: '123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('RepositoriesService.unbind', () => {
  it('404s when the repository does not belong to the project', async () => {
    const service = new RepositoriesService(
      fakePrisma({
        repository: {
          findUnique: vi.fn().mockResolvedValue(repository({ projectId: 'proj_other' })),
        },
      }),
      fakeProjects(),
      fakeGitHubApp([]),
    );

    await expect(service.unbind('proj_1', 'repo_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes when the repository belongs to the project', async () => {
    const del = vi.fn().mockResolvedValue(repository());
    const service = new RepositoriesService(
      fakePrisma({
        repository: { findUnique: vi.fn().mockResolvedValue(repository()), delete: del },
      }),
      fakeProjects(),
      fakeGitHubApp([]),
    );

    await expect(service.unbind('proj_1', 'repo_1')).resolves.toEqual({
      id: 'repo_1',
      deleted: true,
    });
    expect(del).toHaveBeenCalledWith({ where: { id: 'repo_1' } });
  });
});

describe('RepositoriesService.list', () => {
  it('lists repositories ordered by createdAt', async () => {
    const findMany = vi.fn().mockResolvedValue([repository()]);
    const service = new RepositoriesService(
      fakePrisma({ repository: { findMany } }),
      fakeProjects(),
      fakeGitHubApp([]),
    );

    const dtos = await service.list('proj_1');

    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj_1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(dtos).toHaveLength(1);
  });
});
