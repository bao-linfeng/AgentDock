import type { TaskIntent } from '@agentdock/protocol';
import { DEFAULT_MENTION_TRIGGER } from '@agentdock/shared';

/** Normalized input produced from a GitHub event, ready to create a task. */
export interface AgentTaskCreateInput {
  source: 'github';
  /** Stable dedupe key — one source event maps to exactly one task. */
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

export interface NormalizeOptions {
  /** Mention trigger that must be present. Defaults to `@agent`. */
  trigger?: string;
  /** If non-empty, the actor login must be in this list (case-insensitive). */
  allowlist?: string[];
}

/**
 * Return the text following the trigger, or `null` when absent.
 * (Kept for callers that only want the tail after the mention.)
 */
export function extractMention(
  body: string,
  trigger: string = DEFAULT_MENTION_TRIGGER,
): string | null {
  const idx = body.indexOf(trigger);
  if (idx === -1) return null;
  return body.slice(idx + trigger.length).trim();
}

/** True when the body mentions the trigger. */
export function hasMention(body: string, trigger: string = DEFAULT_MENTION_TRIGGER): boolean {
  return body.includes(trigger);
}

/** Remove trigger tokens while preserving the surrounding prompt text. */
export function stripMention(body: string, trigger: string = DEFAULT_MENTION_TRIGGER): string {
  return body.split(trigger).join(' ').replace(/\s+/g, ' ').trim();
}

/** Best-effort intent classification from free-form prompt text. */
export function inferIntent(text: string): TaskIntent {
  const t = text.toLowerCase();
  if (/\b(review|audit|look over|feedback)\b/.test(t)) return 'review';
  if (/\b(fix|bug|broken|repair|resolve|error|crash)\b/.test(t)) return 'fix';
  if (/\b(tests?|unit test|coverage|spec)\b/.test(t)) return 'test';
  if (/\b(implement|add|create|build|feature|support)\b/.test(t)) return 'implement';
  return 'general';
}

/** A login belonging to a bot (GitHub App / Actions) that must never re-trigger. */
function isBot(user: GitHubUser | undefined): boolean {
  if (!user) return false;
  if (user.type && user.type.toLowerCase() === 'bot') return true;
  return /\[bot\]$/i.test(user.login ?? '');
}

function allowed(actor: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const a = actor.toLowerCase();
  return allowlist.some((x) => x.toLowerCase() === a);
}

// --- Minimal payload shapes (subset of the GitHub webhook schema) -------------

interface GitHubUser {
  login?: string;
  type?: string;
}
interface Issueish {
  number?: number;
  title?: string;
  body?: string | null;
  user?: GitHubUser;
}
interface Commentish {
  id?: number;
  body?: string | null;
  user?: GitHubUser;
}
interface Repo {
  full_name?: string;
}
interface WebhookPayload {
  action?: string;
  repository?: Repo;
  issue?: Issueish;
  pull_request?: Issueish;
  comment?: Commentish;
}

interface Extracted {
  actor: GitHubUser | undefined;
  text: string;
  refId: string;
}

/** Pull the actor, trigger text, and dedupe id out of each supported event. */
function extract(event: SupportedGitHubEvent, p: WebhookPayload): Extracted | null {
  switch (event) {
    case 'issues': {
      if (p.action !== 'opened' && p.action !== 'edited') return null;
      const issue = p.issue;
      if (!issue) return null;
      const text = `${issue.title ?? ''}\n\n${issue.body ?? ''}`.trim();
      return { actor: issue.user, text, refId: `issue#${issue.number}` };
    }
    case 'issue_comment': {
      if (p.action !== 'created' && p.action !== 'edited') return null;
      const c = p.comment;
      if (!c) return null;
      return { actor: c.user, text: c.body ?? '', refId: `issue_comment#${c.id}` };
    }
    case 'pull_request': {
      if (p.action !== 'opened' && p.action !== 'edited') return null;
      const pr = p.pull_request;
      if (!pr) return null;
      const text = `${pr.title ?? ''}\n\n${pr.body ?? ''}`.trim();
      return { actor: pr.user, text, refId: `pull_request#${pr.number}` };
    }
    case 'pull_request_review_comment': {
      if (p.action !== 'created' && p.action !== 'edited') return null;
      const c = p.comment;
      if (!c) return null;
      return { actor: c.user, text: c.body ?? '', refId: `review_comment#${c.id}` };
    }
  }
}

/**
 * Normalize a GitHub webhook payload into `AgentTaskCreateInput`.
 *
 * Returns `null` (a no-op, not an error) when the event should not create a
 * task: unsupported action, missing/absent trigger mention, bot self-callback,
 * or an actor outside the allowlist (docs/requirements.md §6, tasks T6.3/T6.4).
 * Signature verification + delivery-id dedupe (T6.2) live in the server layer.
 */
export function normalizeGitHubEvent(
  event: SupportedGitHubEvent,
  payload: unknown,
  options: NormalizeOptions = {},
): AgentTaskCreateInput | null {
  const trigger = options.trigger ?? DEFAULT_MENTION_TRIGGER;
  const p = (payload ?? {}) as WebhookPayload;

  const extracted = extract(event, p);
  if (!extracted) return null;

  const { actor, text, refId } = extracted;

  // Ignore bot self-callbacks (our own status comments, GitHub Apps).
  if (isBot(actor)) return null;

  const login = actor?.login;
  if (!login || !allowed(login, options.allowlist)) return null;

  if (!hasMention(text, trigger)) return null;

  const prompt = stripMention(text, trigger);
  if (!prompt) return null;

  const repo = p.repository?.full_name ?? 'unknown';
  return {
    source: 'github',
    sourceRef: `github:${repo}:${refId}`,
    intent: inferIntent(prompt),
    prompt,
    actor: login,
  };
}
