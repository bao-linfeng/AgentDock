import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type AuditLogDto,
  type ListAuditLogsQuery,
  ListAuditLogsQuerySchema,
} from './audit.dto.js';
import { AuditService } from './audit.service.js';

/** Read-only audit trail (docs/tasks.md T9.5, #63). Entries are never mutated. */
@Controller('audit-logs')
@UseGuards(ApiTokenGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListAuditLogsQuerySchema)) query: ListAuditLogsQuery,
  ): Promise<AuditLogDto[]> {
    return this.audit.list(query);
  }
}
