import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import {
  type GitHubInstallationDto,
  GitHubService,
  type GitHubStatusDto,
} from './github.service.js';

@Controller('github')
@UseGuards(ApiTokenGuard)
export class GitHubController {
  constructor(@Inject(GitHubService) private readonly github: GitHubService) {}

  @Get('status')
  status(): GitHubStatusDto {
    return this.github.status();
  }

  /** Installations of the configured GitHub App, for the repo-binding UI (#28). */
  @Get('installations')
  installations(): Promise<GitHubInstallationDto[]> {
    return this.github.listInstallations();
  }
}
