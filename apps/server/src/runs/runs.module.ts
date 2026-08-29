import { Module } from '@nestjs/common';
import { RunEventsBus } from '../events/run-events.bus.js';
import { PullRequestModule } from '../github/pull-request.module.js';
import { RunCallbackModule } from '../github/run-callback.module.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

@Module({
  imports: [PullRequestModule, RunCallbackModule],
  controllers: [RunsController],
  providers: [RunsService, RunEventsBus],
  exports: [RunsService, RunEventsBus],
})
export class RunsModule {}
