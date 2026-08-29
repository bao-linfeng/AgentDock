import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { GitHubAppModule } from './github-app.module.js';
import { GitHubController } from './github.controller.js';
import { GitHubService } from './github.service.js';
import { RepositoriesController } from './repositories.controller.js';
import { RepositoriesService } from './repositories.service.js';
import { GitHubWebhookService } from './webhook.service.js';

@Module({
  imports: [ProjectsModule, TasksModule, GitHubAppModule],
  controllers: [GitHubController, RepositoriesController],
  providers: [GitHubService, RepositoriesService, GitHubWebhookService],
  exports: [GitHubService, GitHubAppModule, RepositoriesService],
})
export class GitHubModule {}
