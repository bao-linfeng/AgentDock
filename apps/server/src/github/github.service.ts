import { Inject, Injectable } from '@nestjs/common';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';

export interface GitHubStatusDto {
  webhookSecretConfigured: boolean;
  appConfigured: boolean;
  /** Where the GitHub App webhook should point once M6 lands. */
  webhookUrl?: string;
  /** `POST /github/webhook` is now wired (#29): verify + dedupe + normalize. */
  webhookEndpointImplemented: true;
}

/**
 * GitHubModule status reporter — the actual webhook logic lives in
 * `GitHubWebhookService` (#29). This only reports whether the integration is
 * configured, so the web console can surface a "not configured yet" hint.
 */
@Injectable()
export class GitHubService {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  status(): GitHubStatusDto {
    const base = this.config.publicBaseUrl?.replace(/\/+$/, '');
    return {
      webhookSecretConfigured: Boolean(this.config.github.webhookSecret),
      appConfigured: Boolean(this.config.github.appId && this.config.github.privateKey),
      webhookUrl: base ? `${base}/github/webhook` : undefined,
      webhookEndpointImplemented: true,
    };
  }
}
