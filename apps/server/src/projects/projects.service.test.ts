import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Project } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from './projects.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_1',
    name: 'PaymentService',
    workspaceKey: 'payment-service',
    defaultBranch: 'main',
    testCommand: 'pnpm test',
    buildCommand: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Project;
}

// biome-ignore lint/suspicious/noExplicitAny: minimal structural Prisma stub
function fakePrisma(overrides: Record<string, any>): PrismaService {
  return overrides as unknown as PrismaService;
}

const uniqueViolation = Object.assign(new Error('unique'), { code: 'P2002' });

describe('ProjectsService.create', () => {
  it('persists defaults and normalizes empty commands to null', async () => {
    const create = vi.fn().mockResolvedValue(project({ testCommand: null }));
    const service = new ProjectsService(fakePrisma({ project: { create } }));

    const dto = await service.create({
      name: 'PaymentService',
      workspaceKey: 'payment-service',
      defaultBranch: 'main',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        name: 'PaymentService',
        workspaceKey: 'payment-service',
        defaultBranch: 'main',
        testCommand: null,
        buildCommand: null,
      },
    });
    expect(dto).toMatchObject({ id: 'proj_1', defaultBranch: 'main' });
    expect(dto.testCommand).toBeUndefined();
  });

  it('maps a duplicate workspaceKey to 409', async () => {
    const service = new ProjectsService(
      fakePrisma({ project: { create: vi.fn().mockRejectedValue(uniqueViolation) } }),
    );
    await expect(
      service.create({ name: 'a', workspaceKey: 'dup', defaultBranch: 'main' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ProjectsService.update', () => {
  it('404s on an unknown project', async () => {
    const service = new ProjectsService(
      fakePrisma({ project: { findUnique: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('leaves untouched fields undefined and clears commands with null', async () => {
    const update = vi.fn().mockResolvedValue(project({ testCommand: null }));
    const service = new ProjectsService(
      fakePrisma({
        project: { findUnique: vi.fn().mockResolvedValue(project()), update },
      }),
    );

    await service.update('proj_1', { testCommand: null });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'proj_1' },
      data: {
        name: undefined,
        workspaceKey: undefined,
        defaultBranch: undefined,
        testCommand: null,
        buildCommand: undefined,
      },
    });
  });
});

describe('ProjectsService.remove', () => {
  it('refuses to delete while runs are in flight', async () => {
    const service = new ProjectsService(
      fakePrisma({
        project: { findUnique: vi.fn().mockResolvedValue(project()), delete: vi.fn() },
        taskRun: { count: vi.fn().mockResolvedValue(2) },
      }),
    );
    await expect(service.remove('proj_1')).rejects.toThrow(/2 active run/);
  });

  it('deletes when no run is active', async () => {
    const del = vi.fn().mockResolvedValue(project());
    const service = new ProjectsService(
      fakePrisma({
        project: { findUnique: vi.fn().mockResolvedValue(project()), delete: del },
        taskRun: { count: vi.fn().mockResolvedValue(0) },
      }),
    );
    await expect(service.remove('proj_1')).resolves.toEqual({ id: 'proj_1', deleted: true });
    expect(del).toHaveBeenCalledWith({ where: { id: 'proj_1' } });
  });
});
