import { Module } from '@nestjs/common';
import { RunnersController } from './runners.controller.js';
import { RunnersService } from './runners.service.js';

@Module({
  controllers: [RunnersController],
  providers: [RunnersService],
  exports: [RunnersService],
})
export class RunnersModule {}
