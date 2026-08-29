import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { Runner } from '@prisma/client';
import type { ApprovalDto } from '../approvals/approvals.dto.js';
import { type RequestApprovalInput, RequestApprovalSchema } from '../approvals/approvals.dto.js';
import { CurrentRunner, RunnerToken, RunnerTokenGuard } from '../auth/runner-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type RegisterRunnerInput,
  RegisterRunnerSchema,
  type RunnerDto,
} from '../runners/runners.dto.js';
import { RunnersService } from '../runners/runners.service.js';
import {
  type AppendRunEventInput,
  AppendRunEventSchema,
  type CompleteRunInput,
  CompleteRunSchema,
  type HeartbeatInput,
  HeartbeatSchema,
  type RunDto,
  type RunEventDto,
} from '../runs/runs.dto.js';
import type {
  ClaimResponseDto,
  RunHeartbeatResponseDto,
  RunnerHeartbeatResponseDto,
} from './runner-gateway.dto.js';
import { RunnerGatewayService } from './runner-gateway.service.js';

/**
 * Runner Gateway routes (docs/architecture.md §9):
 *   POST /runner/register
 *   GET  /runner/tasks/claim
 *   POST /runner/runs/:id/events
 *   POST /runner/runs/:id/heartbeat   -> { cancelRequested, approval? }
 *   POST /runner/runs/:id/approvals   -> request approval for a gated action (#37)
 *   POST /runner/runs/:id/complete
 *   POST /runner/heartbeat            (idle heartbeat)
 */
@Controller('runner')
@UseGuards(RunnerTokenGuard)
export class RunnerGatewayController {
  constructor(
    @Inject(RunnerGatewayService) private readonly gateway: RunnerGatewayService,
    @Inject(RunnersService) private readonly runners: RunnersService,
  ) {}

  @Post('register')
  register(
    @RunnerToken() token: string,
    @Body(new ZodValidationPipe(RegisterRunnerSchema)) body: RegisterRunnerInput,
  ): Promise<RunnerDto> {
    return this.runners.register(token, body);
  }

  @Get('tasks/claim')
  claim(@CurrentRunner() runner: Runner | null): Promise<ClaimResponseDto> {
    return this.gateway.claim(this.gateway.requireRegistered(runner));
  }

  @Post('heartbeat')
  heartbeat(@CurrentRunner() runner: Runner | null): Promise<RunnerHeartbeatResponseDto> {
    return this.gateway.runnerHeartbeat(this.gateway.requireRegistered(runner));
  }

  @Post('runs/:id/events')
  events(
    @CurrentRunner() runner: Runner | null,
    @Param('id') runId: string,
    @Body(new ZodValidationPipe(AppendRunEventSchema)) body: AppendRunEventInput,
  ): Promise<RunEventDto> {
    return this.gateway.appendEvent(this.gateway.requireRegistered(runner), runId, body);
  }

  @Post('runs/:id/heartbeat')
  runHeartbeat(
    @CurrentRunner() runner: Runner | null,
    @Param('id') runId: string,
    @Body(new ZodValidationPipe(HeartbeatSchema)) body: HeartbeatInput,
  ): Promise<RunHeartbeatResponseDto> {
    return this.gateway.runHeartbeat(this.gateway.requireRegistered(runner), runId, body.note);
  }

  @Post('runs/:id/approvals')
  requestApproval(
    @CurrentRunner() runner: Runner | null,
    @Param('id') runId: string,
    @Body(new ZodValidationPipe(RequestApprovalSchema)) body: RequestApprovalInput,
  ): Promise<ApprovalDto> {
    return this.gateway.requestApproval(this.gateway.requireRegistered(runner), runId, body);
  }

  @Post('runs/:id/complete')
  complete(
    @CurrentRunner() runner: Runner | null,
    @Param('id') runId: string,
    @Body(new ZodValidationPipe(CompleteRunSchema)) body: CompleteRunInput,
  ): Promise<RunDto> {
    return this.gateway.complete(this.gateway.requireRegistered(runner), runId, body);
  }
}
