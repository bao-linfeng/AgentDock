import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [RunsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
