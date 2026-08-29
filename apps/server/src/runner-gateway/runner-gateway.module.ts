import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { RunCallbackModule } from '../github/run-callback.module.js';
import { RunnersModule } from '../runners/runners.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { RunnerGatewayController } from './runner-gateway.controller.js';
import { RunnerGatewayService } from './runner-gateway.service.js';

@Module({
  imports: [RunnersModule, RunsModule, RunCallbackModule, ApprovalsModule],
  controllers: [RunnerGatewayController],
  providers: [RunnerGatewayService],
})
export class RunnerGatewayModule {}
