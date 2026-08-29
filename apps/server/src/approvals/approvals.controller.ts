import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type ApprovalDto,
  type ResolveApprovalInput,
  ResolveApprovalSchema,
} from './approvals.dto.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * Web-facing approval routes (docs/tasks.md T8.3, #37).
 *
 * Runner-facing request creation lives on the Runner Gateway
 * (`POST /runner/runs/:id/approvals`) instead, since only the runner knows it
 * is about to attempt a gated action.
 */
@Controller()
@UseGuards(ApiTokenGuard)
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @Get('approvals/pending')
  listPending(): Promise<ApprovalDto[]> {
    return this.approvals.listPending();
  }

  @Get('runs/:runId/approvals')
  listForRun(@Param('runId') runId: string): Promise<ApprovalDto[]> {
    return this.approvals.listForRun(runId);
  }

  @Get('approvals/:id')
  get(@Param('id') id: string): Promise<ApprovalDto> {
    return this.approvals.get(id);
  }

  @Post('approvals/:id/resolve')
  resolve(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveApprovalSchema)) body: ResolveApprovalInput,
  ): Promise<ApprovalDto> {
    return this.approvals.resolve(id, body);
  }
}
