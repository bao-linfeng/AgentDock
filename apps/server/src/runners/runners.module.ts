import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RunsModule } from '../runs/runs.module.js';
import { RunnerDisconnectSweeper } from './runner-disconnect.sweeper.js';
import { RunnersController } from './runners.controller.js';
import { RunnersService } from './runners.service.js';

@Module({
  imports: [ScheduleModule.forRoot(), RunsModule],
  controllers: [RunnersController],
  providers: [RunnersService, RunnerDisconnectSweeper],
  exports: [RunnersService],
})
export class RunnersModule {}
