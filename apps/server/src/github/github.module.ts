import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { GitHubAppService } from './github-app.service.js';
import { GitHubController } from './github.controller.js';
import { GitHubService } from './github.service.js';
import { RepositoriesController } from './repositories.controller.js';
import { RepositoriesService } from './repositories.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [GitHubController, RepositoriesController],
  providers: [GitHubService, GitHubAppService, RepositoriesService],
  exports: [GitHubService, GitHubAppService, RepositoriesService],
})
export class GitHubModule {}
