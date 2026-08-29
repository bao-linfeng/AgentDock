import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type RunnerDto,
  type RunnerProjectDto,
  type UpsertRunnerProjectInput,
  UpsertRunnerProjectSchema,
} from './runners.dto.js';
import { RunnersService } from './runners.service.js';

/** Web-facing runner administration. The runner itself talks to `/runner/*`. */
@Controller('runners')
@UseGuards(ApiTokenGuard)
export class RunnersController {
  constructor(@Inject(RunnersService) private readonly runners: RunnersService) {}

  @Get()
  list(): Promise<RunnerDto[]> {
    return this.runners.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<RunnerDto> {
    return this.runners.get(id);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string): Promise<RunnerDto> {
    return this.runners.revoke(id);
  }

  @Get(':id/projects')
  listProjects(@Param('id') id: string): Promise<RunnerProjectDto[]> {
    return this.runners.listProjects(id);
  }

  @Put(':id/projects/:projectId')
  upsertProject(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(UpsertRunnerProjectSchema)) body: UpsertRunnerProjectInput,
  ): Promise<RunnerProjectDto> {
    return this.runners.upsertProject(id, projectId, body);
  }

  @Delete(':id/projects/:projectId')
  removeProject(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ): Promise<{ runnerId: string; projectId: string; deleted: true }> {
    return this.runners.removeProject(id, projectId);
  }
}
