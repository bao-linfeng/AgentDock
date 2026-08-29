import { Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { EventsModule } from './events/events.module.js';
import { GitHubModule } from './github/github.module.js';
import { HealthController } from './health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { RunnerGatewayModule } from './runner-gateway/runner-gateway.module.js';
import { RunnersModule } from './runners/runners.module.js';
import { RunsModule } from './runs/runs.module.js';
import { TasksModule } from './tasks/tasks.module.js';

/**
 * Root module (docs/tasks.md T2.1).
 *
 * Auth is a thin static-token guard rather than a user system — confirmed MVP
 * decision, so there is no `users` table (docs/architecture.md §7).
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    ProjectsModule,
    TasksModule,
    RunsModule,
    RunnersModule,
    RunnerGatewayModule,
    GitHubModule,
    EventsModule,
    ApprovalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
