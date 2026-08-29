import { Module } from '@nestjs/common';
import { GitHubAppModule } from './github-app.module.js';
import { RunCallbackService } from './run-callback.service.js';

/**
 * Standalone module so `RunsModule` can post GitHub status callback comments
 * (#31) without importing the full `GitHubModule` (which depends on
 * `TasksModule` and would cycle back through `TasksModule -> RunsModule`) —
 * same rationale as `PullRequestModule`.
 */
@Module({
  imports: [GitHubAppModule],
  providers: [RunCallbackService],
  exports: [RunCallbackService],
})
export class RunCallbackModule {}
