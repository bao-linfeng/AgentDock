import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Project } from '@prisma/client';
import { toIso } from '../common/serialize.js';
import { PrismaService, isUniqueConstraintError } from '../prisma/prisma.service.js';
import { parseEvidenceRules } from './evidence-rules.js';
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from './projects.dto.js';

/** Run statuses that mean "a runner may still be working on it". */
const ACTIVE_RUN_STATUSES = [
  'queued',
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
] as const;

export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    workspaceKey: project.workspaceKey,
    defaultBranch: project.defaultBranch,
    testCommand: project.testCommand ?? undefined,
    buildCommand: project.buildCommand ?? undefined,
    evidenceRules: parseEvidenceRules(project.evidenceRulesJson),
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
  };
}

/**
 * Map the API-level `evidenceRules` field onto a Prisma JSON column update:
 * `undefined` leaves it untouched, `null` clears the override.
 */
function evidenceRulesData(
  evidenceRules: CreateProjectInput['evidenceRules'],
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (evidenceRules === undefined) return undefined;
  if (evidenceRules === null) return Prisma.JsonNull;
  return evidenceRules as Prisma.InputJsonValue;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateProjectInput): Promise<ProjectDto> {
    try {
      const project = await this.prisma.project.create({
        data: {
          name: input.name,
          workspaceKey: input.workspaceKey,
          defaultBranch: input.defaultBranch,
          testCommand: input.testCommand ?? null,
          buildCommand: input.buildCommand ?? null,
          evidenceRulesJson: evidenceRulesData(input.evidenceRules),
        },
      });
      return toProjectDto(project);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(`workspaceKey already in use: ${input.workspaceKey}`);
      }
      throw error;
    }
  }

  async list(): Promise<ProjectDto[]> {
    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    return projects.map(toProjectDto);
  }

  /** Fetch a project or throw 404. Shared with tasks / runner gateway. */
  async requireProject(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException(`unknown project: ${id}`);
    return project;
  }

  async get(id: string): Promise<ProjectDto> {
    return toProjectDto(await this.requireProject(id));
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    await this.requireProject(id);
    try {
      const project = await this.prisma.project.update({
        where: { id },
        data: {
          name: input.name,
          workspaceKey: input.workspaceKey,
          defaultBranch: input.defaultBranch,
          // `null` clears the command, `undefined` leaves it untouched.
          testCommand: input.testCommand,
          buildCommand: input.buildCommand,
          evidenceRulesJson: evidenceRulesData(input.evidenceRules),
        },
      });
      return toProjectDto(project);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(`workspaceKey already in use: ${input.workspaceKey}`);
      }
      throw error;
    }
  }

  /**
   * Delete a project. Refuses while runs are still in flight so a runner never
   * loses the project it is currently executing against.
   */
  async remove(id: string): Promise<{ id: string; deleted: true }> {
    await this.requireProject(id);
    const active = await this.prisma.taskRun.count({
      where: { task: { projectId: id }, status: { in: [...ACTIVE_RUN_STATUSES] } },
    });
    if (active > 0) {
      throw new ConflictException(
        `project has ${active} active run(s); cancel them before deleting`,
      );
    }
    await this.prisma.project.delete({ where: { id } });
    return { id, deleted: true };
  }
}
