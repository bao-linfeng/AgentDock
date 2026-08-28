import { type RunStatus, type TaskStatus, assertTransition, isTerminal } from '@agentdock/protocol';

/**
 * Derive the coarse task-level status from its latest run status.
 * See docs/requirements.md §5 review note (Task <-> Run cardinality).
 */
export function deriveTaskStatus(latestRunStatus: RunStatus): TaskStatus {
  switch (latestRunStatus) {
    case 'queued':
    case 'assigned':
      return 'queued';
    case 'running':
    case 'needs_approval':
    case 'verifying':
    case 'publishing':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/**
 * Task/Run scheduling engine — STUB.
 *
 * TODO(M2/M3): claim/assign runs to runners atomically, advance run status via
 * `assertTransition`, persist events. This class only guards transitions today.
 */
export class RunLifecycle {
  constructor(private status: RunStatus = 'queued') {}

  get current(): RunStatus {
    return this.status;
  }

  transitionTo(next: RunStatus): RunStatus {
    assertTransition(this.status, next);
    this.status = next;
    return this.status;
  }

  get done(): boolean {
    return isTerminal(this.status);
  }
}
