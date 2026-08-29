import type { RawBodyRequest } from '@nestjs/common';
import { Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTokenGuard } from '../auth/api-token.guard.js';
import { GitHubService, type GitHubStatusDto } from './github.service.js';
import type { GitHubWebhookHeaders, WebhookResult } from './webhook.dto.js';
import { GitHubWebhookService } from './webhook.service.js';

/**
 * Minimal shape we rely on from the underlying HTTP request. Avoids pulling
 * in `express` types directly (this repo otherwise stays framework-neutral
 * at the type level — see other controllers).
 */
interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

@Controller('github')
export class GitHubController {
  constructor(
    @Inject(GitHubService) private readonly github: GitHubService,
    @Inject(GitHubWebhookService) private readonly webhook: GitHubWebhookService,
  ) {}

  @Get('status')
  @UseGuards(ApiTokenGuard)
  status(): GitHubStatusDto {
    return this.github.status();
  }

  /**
   * Public webhook receiver — intentionally **not** behind `ApiTokenGuard`:
   * GitHub cannot send our API token, so authenticity is instead established
   * by the `X-Hub-Signature-256` HMAC check inside `GitHubWebhookService`
   * (docs/architecture.md §14, requirements.md §6).
   */
  @Post('webhook')
  @HttpCode(200)
  webhookHandler(@Req() request: RawBodyRequest<WebhookRequest>): Promise<WebhookResult> {
    const headers: GitHubWebhookHeaders = {
      signature256: headerValue(request, 'x-hub-signature-256'),
      event: headerValue(request, 'x-github-event'),
      deliveryId: headerValue(request, 'x-github-delivery'),
    };
    return this.webhook.handle(request.rawBody, headers, request.body);
  }
}

function headerValue(request: WebhookRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
