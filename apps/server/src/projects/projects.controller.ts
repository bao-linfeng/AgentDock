import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type CreateProjectInput,
  CreateProjectSchema,
  type ProjectDto,
  type UpdateProjectInput,
  UpdateProjectSchema,
} from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
@UseGuards(ApiTokenGuard)
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: CreateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.create(body);
  }

  @Get()
  list(): Promise<ProjectDto[]> {
    return this.projects.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProjectDto> {
    return this.projects.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) body: UpdateProjectInput,
  ): Promise<ProjectDto> {
    return this.projects.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.projects.remove(id);
  }
}
