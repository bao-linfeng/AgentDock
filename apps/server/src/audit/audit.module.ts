import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Audit trail (docs/tasks.md T9.5, #63).
 *
 * `@Global` so every feature module can inject `AuditService` without each of
 * them importing this module — audit writes are cross-cutting and must not
 * introduce module cycles (tasks -> runs -> approvals all record entries).
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
