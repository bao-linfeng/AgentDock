import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/**
 * Root module.
 *
 * TODO(M2/T2.1): register AuthModule, ProjectsModule, TasksModule, RunsModule,
 * RunnersModule, GitHubModule, EventsModule as they are implemented.
 * Confirmed decision: MVP uses a single-user static token (no users table),
 * so AuthModule will be a thin token guard rather than a full user system.
 */
@Module({
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
