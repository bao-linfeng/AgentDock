import type { TaskIntent } from '@agentdock/protocol';
import { DEFAULT_MENTION_TRIGGER } from '@agentdock/shared';

/** Normalized input produced from a GitHub event, ready to create a task. */
export interface AgentTaskCreateInput {
  source: 'github';
  sourceRef: string;
  intent: TaskIntent;
  prompt: string;
  actor: string;
}

/** Supported GitHub webhook event kinds for MVP. */
export type SupportedGitHubEvent =
  | 'issues'
  | 'issue_comment'
  | 'pull_request'
  | 'pull_request_review_comment';

/**
 * Extract the prompt from a comment body if it mentions the trigger.
 * Returns `null` when the trigger is absent.
 */
export function extractMention(
  body: string,
  trigger: string = DEFAULT_MENTION_TRIGGER,
): string | null {
  const idx = body.indexOf(trigger);
  if (idx === -1) return null;
  return body.slice(idx + trigger.length).trim();
}

/**
 * Normalize a GitHub webhook payload into AgentTaskCreateInput — STUB.
 *
 * TODO(M6/T6.2): verify webhook signature + dedupe by delivery id.
 * TODO(M6/T6.3): map issue/comment/PR payloads to a normalized input.
 * TODO(M6/T6.4): enforce actor allowlist, ignore bot self-callbacks.
 * NOTE: GitHub integration is Milestone 6 and deferred until the
 *       Web -> Runner -> OpenCode -> Git loop is proven.
 */
export function normalizeGitHubEvent(
  _event: SupportedGitHubEvent,
  _payload: unknown,
): AgentTaskCreateInput | null {
  throw new Error('normalizeGitHubEvent not implemented yet (M6/T6.3)');
}
