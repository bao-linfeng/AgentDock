import type { ApprovalGate } from '@agentdock/agent-runtime';
import type { RunnerClient } from './runner-client.js';

/** How often to poll `runHeartbeat` while blocked on a pending approval, in ms. */
const DEFAULT_APPROVAL_POLL_INTERVAL_MS = 3_000;
/** Give up waiting for a human decision after this long (default: 24h). */
const DEFAULT_APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000;

export interface RunnerApprovalGateOptions {
  client: RunnerClient;
  /** How often to poll for a decision while blocked, in ms. */
  pollIntervalMs?: number;
  /** Max time to wait for a decision before treating the request as denied, in ms. */
  timeoutMs?: number;
  onLog?: (message: string) => void;
  /** Test seam: overrides `setTimeout`/`clearTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Real `ApprovalGate` for the Local Runner (docs/tasks.md T8.3, #37).
 *
 * The Runner has no inbound channel (docs/architecture.md §9): it requests
 * approval via `POST /runner/runs/:id/approvals` (which also moves the run to
 * `needs_approval`) and then polls `POST /runner/runs/:id/heartbeat` — the
 * same channel used for cancellation — until the approval is no longer
 * `pending`. A request that is never resolved times out as `denied` rather
 * than blocking the run forever.
 */
export class RunnerApprovalGate implements ApprovalGate {
  private readonly client: RunnerClient;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly onLog: (message: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RunnerApprovalGateOptions) {
    this.client = options.client;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_APPROVAL_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.onLog = options.onLog ?? (() => {});
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async requestShellApproval(input: {
    runId: string;
    summary: string;
    detail: unknown;
  }): Promise<'approved' | 'denied'> {
    return this.requestApproval(input.runId, 'shell', input.summary, input.detail);
  }

  /** Push approval (docs/tasks.md T8.3) — gates `WorktreeManager.push()`. */
  async requestPushApproval(
    runId: string,
    summary: string,
    detail?: unknown,
  ): Promise<'approved' | 'denied'> {
    return this.requestApproval(runId, 'push', summary, detail);
  }

  /** Destructive-operation approval (docs/tasks.md T8.3) — generic gate for anything flagged as irreversible. */
  async requestDestructiveApproval(
    runId: string,
    summary: string,
    detail?: unknown,
  ): Promise<'approved' | 'denied'> {
    return this.requestApproval(runId, 'destructive', summary, detail);
  }

  private async requestApproval(
    runId: string,
    action: 'shell' | 'push' | 'destructive',
    summary: string,
    detail?: unknown,
  ): Promise<'approved' | 'denied'> {
    this.onLog(`requesting ${action} approval: ${summary}`);
    const approval = await this.client.requestApproval(runId, {
      action,
      summary,
      detail: isPlainObject(detail) ? detail : undefined,
    });

    if (approval.status !== 'pending') {
      return approval.status === 'approved' ? 'approved' : 'denied';
    }

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      const heartbeat = await this.client.runHeartbeat(runId);
      if (
        heartbeat.approval?.approvalId === approval.id &&
        heartbeat.approval.status !== 'pending'
      ) {
        this.onLog(`${action} approval ${heartbeat.approval.status}: ${summary}`);
        return heartbeat.approval.status === 'approved' ? 'approved' : 'denied';
      }
    }

    this.onLog(
      `${action} approval timed out after ${this.timeoutMs}ms, treating as denied: ${summary}`,
    );
    return 'denied';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
