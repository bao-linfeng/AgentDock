import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from '@prisma/client';
import { toIso } from '../common/serialize.js';
import { PrismaService, isUniqueConstraintError } from '../prisma/prisma.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { GitHubAppService } from './github-app.service.js';
import type { BindRepositoryInput, RepositoryDto } from './repositories.dto.js';

export function toRepositoryDto(repository: Repository): RepositoryDto {
  return {
    id: repository.id,
    projectId: repository.projectId,
    provider: repository.provider,
    owner: repository.owner,
    repo: repository.repo,
    installationId: repository.installationId ?? undefined,
    createdAt: toIso(repository.createdAt),
  };
}

/**
 * Binds a GitHub repository to a Project (docs/tasks.md T6.1, architecture §7
 * `repositories` table). One project can bind multiple repositories; one
 * repository binds to exactly one project (`@@unique([provider, owner, repo])`
 * in the Prisma schema).
 */
@Injectable()
export class RepositoriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(GitHubAppService) private readonly githubApp: GitHubAppService,
  ) {}

  async list(projectId: string): Promise<RepositoryDto[]> {
    await this.projects.requireProject(projectId);
    const repositories = await this.prisma.repository.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return repositories.map(toRepositoryDto);
  }

  /**
   * Bind a repository to a project. Fails closed if the GitHub App isn't
   * configured, or if the given `installationId` cannot actually see
   * `owner/repo` — a wrong installation id would otherwise silently create a
   * binding that every later API call (#30/#31) fails against.
   */
  async bind(projectId: string, input: BindRepositoryInput): Promise<RepositoryDto> {
    await this.projects.requireProject(projectId);

    const accessible = await this.githubApp.listInstallationRepositories(input.installationId);
    const matches = accessible.some(
      (r) =>
        r.owner.toLowerCase() === input.owner.toLowerCase() &&
        r.repo.toLowerCase() === input.repo.toLowerCase(),
    );
    if (!matches) {
      throw new BadRequestException(
        `installation ${input.installationId} does not have access to ${input.owner}/${input.repo}`,
      );
    }

    try {
      const repository = await this.prisma.repository.create({
        data: {
          projectId,
          provider: input.provider,
          owner: input.owner,
          repo: input.repo,
          installationId: input.installationId,
        },
      });
      return toRepositoryDto(repository);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          `repository already bound: ${input.provider}:${input.owner}/${input.repo}`,
        );
      }
      throw error;
    }
  }

  async unbind(projectId: string, repositoryId: string): Promise<{ id: string; deleted: true }> {
    await this.projects.requireProject(projectId);
    const repository = await this.prisma.repository.findUnique({ where: { id: repositoryId } });
    if (!repository || repository.projectId !== projectId) {
      throw new NotFoundException(`unknown repository: ${repositoryId}`);
    }
    await this.prisma.repository.delete({ where: { id: repositoryId } });
    return { id: repositoryId, deleted: true };
  }
}
