import { Module } from '@nestjs/common';
import { RunEventsBus } from '../events/run-events.bus.js';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

@Module({
  controllers: [RunsController],
  providers: [RunsService, RunEventsBus],
  exports: [RunsService, RunEventsBus],
})
export class RunsModule {}
