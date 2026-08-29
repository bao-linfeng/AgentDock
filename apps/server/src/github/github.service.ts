import { Inject, Injectable } from '@nestjs/common';
import { SERVER_CONFIG } from '../config/config.module.js';
import type { ServerConfig } from '../config/env.js';

export interface GitHubStatusDto {
  webhookSecretConfigured: boolean;
  appConfigured: boolean;
  /** Where the GitHub App webhook should point once M6 lands. */
  webhookUrl?: string;
  /** Milestone 6 (#28/#29) wires the webhook route itself. */
  webhookEndpointImplemented: false;
}

/**
 * GitHubModule placeholder.
 *
 * Only reports whether the integration is configured. The public
 * `POST /github/webhook` route is intentionally **not** registered yet: it must
 * ship together with signature verification and delivery dedupe (#29), because
 * an unauthenticated public endpoint would otherwise be exposed through the
 * tunnel (docs/architecture.md §14).
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
      webhookEndpointImplemented: false,
    };
  }
}
