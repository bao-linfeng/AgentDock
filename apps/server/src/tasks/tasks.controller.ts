import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { RunDto } from '../runs/runs.dto.js';
import { RunsService } from '../runs/runs.service.js';
import {
  type CreateTaskInput,
  type CreateTaskResult,
  CreateTaskSchema,
  type ListTasksQuery,
  ListTasksQuerySchema,
  type TaskDto,
} from './tasks.dto.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
@UseGuards(ApiTokenGuard)
export class TasksController {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    return this.tasks.create(body);
  }

  @Get()
  list(
    @Query(new ZodValidationPipe(ListTasksQuerySchema)) query: ListTasksQuery,
  ): Promise<TaskDto[]> {
    return this.tasks.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<TaskDto> {
    return this.tasks.get(id);
  }

  @Get(':id/runs')
  runsForTask(@Param('id') id: string): Promise<RunDto[]> {
    return this.runs.listForTask(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<TaskDto> {
    return this.tasks.cancel(id);
  }
}
