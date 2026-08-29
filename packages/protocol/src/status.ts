/**
 * Authoritative run-status vocabulary and state machine.
 *
 * This is the single source of truth for run lifecycle states, per
 * docs/architecture.md §8 (confirmed decision: architecture §8 is authoritative
 * over requirements.md §5 / US-03). Do NOT introduce alternate spellings such as
 * `testing` / `pushing` / `pull_request_created` elsewhere.
 */
export const RUN_STATUSES = [
  'queued',
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** States from which no further transition is allowed. */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: RunStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Allowed forward transitions. A run may be cancelled or failed from any
 * non-terminal state, so `cancelled` / `failed` are appended to every entry.
 */
const BASE_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ['assigned'],
  assigned: ['running'],
  running: ['needs_approval', 'verifying'],
  needs_approval: ['running', 'verifying', 'publishing'],
  verifying: ['publishing'],
  publishing: ['needs_approval', 'succeeded'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = Object.fromEntries(
  RUN_STATUSES.map((s) => {
    if (isTerminal(s)) return [s, []] as const;
    const extra: RunStatus[] = ['failed', 'cancelled'];
    return [s, Array.from(new Set([...BASE_TRANSITIONS[s], ...extra]))] as const;
  }),
) as Record<RunStatus, readonly RunStatus[]>;

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`Invalid run status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Assert a transition is legal, throwing `InvalidTransitionError` otherwise. */
export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
