import { Module } from '@nestjs/common';
import { GitHubAppService } from './github-app.service.js';

/**
 * Standalone module for `GitHubAppService` (App/installation auth only, #28).
 *
 * Split out from `GitHubModule` so consumers that only need an authenticated
 * Octokit client (e.g. `PullRequestModule`, #30) don't have to pull in
 * `GitHubModule`'s dependency on `TasksModule` — that edge would otherwise
 * create a module import cycle back through `RunsModule` (`RunsModule ->
 * PullRequestModule -> GitHubModule -> TasksModule -> RunsModule`).
 */
@Module({
  providers: [GitHubAppService],
  exports: [GitHubAppService],
})
export class GitHubAppModule {}
