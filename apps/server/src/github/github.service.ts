import { Inject, Injectable } from '@nestjs/common';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';
import { GitHubAppService } from './github-app.service.js';

export interface GitHubStatusDto {
  webhookSecretConfigured: boolean;
  appConfigured: boolean;
  /** Where the GitHub App webhook should point once M6 lands. */
  webhookUrl?: string;
  /** `POST /github/webhook` is now wired (#29): verify + dedupe + normalize. */
  webhookEndpointImplemented: true;
}

export interface GitHubInstallationDto {
  id: string;
  account: string;
}

/**
 * GitHub integration status + App-level lookups.
 *
 * Webhook signature verification, delivery dedupe, and normalization live in
 * `GitHubWebhookService` (#29). App authentication (JWT + installation
 * tokens, #28) and repository binding (`RepositoriesController`) are also
 * already available.
 */
@Injectable()
export class GitHubService {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(GitHubAppService) private readonly githubApp: GitHubAppService,
  ) {}

  status(): GitHubStatusDto {
    const base = this.config.publicBaseUrl?.replace(/\/+$/, '');
    return {
      webhookSecretConfigured: Boolean(this.config.github.webhookSecret),
      appConfigured: this.githubApp.isConfigured(),
      webhookUrl: base ? `${base}/github/webhook` : undefined,
      webhookEndpointImplemented: true,
    };
  }

  /** List installations of the configured GitHub App, for the repo-binding UI. */
  async listInstallations(): Promise<GitHubInstallationDto[]> {
    const octokit = this.githubApp.appOctokit();
    const installations: GitHubInstallationDto[] = [];
    for await (const response of octokit.paginate.iterator(octokit.rest.apps.listInstallations, {
      per_page: 100,
    })) {
      for (const installation of response.data) {
        const account = installation.account as { login?: string; slug?: string } | null;
        installations.push({
          id: String(installation.id),
          account: account?.login ?? account?.slug ?? 'unknown',
        });
      }
    }
    return installations;
  }
}
