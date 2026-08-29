import type { SupportedGitHubEvent } from '@agentdock/github-adapter';

/** The GitHub headers relevant to verification and dedupe (T6.2). */
export interface GitHubWebhookHeaders {
  /** `X-Hub-Signature-256` — HMAC-SHA256 of the raw body, `sha256=<hex>`. */
  signature256?: string;
  /** `X-GitHub-Event` — e.g. `issue_comment`, `ping`. */
  event?: string;
  /** `X-GitHub-Delivery` — unique per delivery attempt; used for dedupe. */
  deliveryId?: string;
}

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set<SupportedGitHubEvent>([
  'issues',
  'issue_comment',
  'pull_request',
  'pull_request_review_comment',
]);

/** True when `event` is one `normalizeGitHubEvent` knows how to handle. */
export function isSupportedGitHubEvent(event: string | undefined): event is SupportedGitHubEvent {
  return Boolean(event) && SUPPORTED_EVENTS.has(event as string);
}

export interface WebhookResult {
  status: 'accepted' | 'ignored' | 'deduplicated';
  taskId?: string;
  reason?: string;
}
