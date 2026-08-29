import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

// Imports `RunsModule` (rather than providing its own `RunEventsBus`) so
// approval events are published on the same in-process bus instance that
// `RunsService`/`EventsController` use for SSE fan-out.
@Module({
  imports: [RunsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
