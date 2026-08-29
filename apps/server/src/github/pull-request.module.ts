import { Module } from '@nestjs/common';
import { GitHubAppModule } from './github-app.module.js';
import { PullRequestService } from './pull-request.service.js';

/**
 * Standalone module so `RunsModule` can create Pull Requests (#30) without
 * importing the full `GitHubModule` (which depends on `TasksModule` and
 * would cycle back through `TasksModule -> RunsModule`).
 */
@Module({
  imports: [GitHubAppModule],
  providers: [PullRequestService],
  exports: [PullRequestService],
})
export class PullRequestModule {}
