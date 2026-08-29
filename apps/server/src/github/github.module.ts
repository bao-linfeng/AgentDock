import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module.js';
import { GitHubController } from './github.controller.js';
import { GitHubService } from './github.service.js';
import { GitHubWebhookService } from './webhook.service.js';

@Module({
  imports: [TasksModule],
  controllers: [GitHubController],
  providers: [GitHubService, GitHubWebhookService],
  exports: [GitHubService],
})
export class GitHubModule {}
