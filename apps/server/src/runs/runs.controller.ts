import { Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type ArtifactDto,
  type RunDto,
  type RunEventDto,
  type RunEventsQuery,
  RunEventsQuerySchema,
} from './runs.dto.js';
import { RunsService } from './runs.service.js';

@Controller('runs')
@UseGuards(ApiTokenGuard)
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Get(':id')
  get(@Param('id') id: string): Promise<RunDto> {
    return this.runs.get(id);
  }

  @Get(':id/events')
  events(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(RunEventsQuerySchema)) query: RunEventsQuery,
  ): Promise<RunEventDto[]> {
    return this.runs.listEvents(id, query);
  }

  @Get(':id/artifacts')
  artifacts(@Param('id') id: string): Promise<ArtifactDto[]> {
    return this.runs.listArtifacts(id);
  }

  /** Request cancellation; the runner learns about it via its heartbeat. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<RunDto> {
    return this.runs.requestCancel(id);
  }
}
