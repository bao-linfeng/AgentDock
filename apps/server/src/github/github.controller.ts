import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { GitHubService, type GitHubStatusDto } from './github.service.js';

@Controller('github')
@UseGuards(ApiTokenGuard)
export class GitHubController {
  constructor(@Inject(GitHubService) private readonly github: GitHubService) {}

  @Get('status')
  status(): GitHubStatusDto {
    return this.github.status();
  }
}
