import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [RunsModule],
  controllers: [EventsController],
})
export class EventsModule {}
