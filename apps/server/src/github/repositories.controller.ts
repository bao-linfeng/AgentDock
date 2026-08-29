import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type BindRepositoryInput,
  BindRepositorySchema,
  type RepositoryDto,
} from './repositories.dto.js';
import { RepositoriesService } from './repositories.service.js';

/** Nested under `/projects/:projectId/repositories` (architecture §7). */
@Controller('projects/:projectId/repositories')
@UseGuards(ApiTokenGuard)
export class RepositoriesController {
  constructor(@Inject(RepositoriesService) private readonly repositories: RepositoriesService) {}

  @Get()
  list(@Param('projectId') projectId: string): Promise<RepositoryDto[]> {
    return this.repositories.list(projectId);
  }

  @Post()
  bind(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(BindRepositorySchema)) body: BindRepositoryInput,
  ): Promise<RepositoryDto> {
    return this.repositories.bind(projectId, body);
  }

  @Delete(':repositoryId')
  unbind(
    @Param('projectId') projectId: string,
    @Param('repositoryId') repositoryId: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.repositories.unbind(projectId, repositoryId);
  }
}
