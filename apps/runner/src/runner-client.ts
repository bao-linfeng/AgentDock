import { platform } from 'node:os';
import type { RunArtifact, TaskIntent, TaskSource } from '@agentdock/protocol';

/** Response shape for `POST /runner/register` (see apps/server RunnerDto). */
export interface RegisteredRunner {
  id: string;
  name: string;
  status: 'online' | 'offline';
  online: boolean;
  revoked: boolean;
}

/** Response shape for `POST /runner/heartbeat` (idle heartbeat). */
export interface RunnerHeartbeatResponse {
  runnerId: string;
  activeRuns: { runId: string; status: string; cancelRequested: boolean }[];
}

/** A run's DTO as reported by the server (`apps/server/src/runs/runs.dto.ts`). */
export interface RunDto {
  id: string;
  taskId: string;
  runnerId?: string;
  executor: string;
  status: string;
  branch?: string;
  worktreePath?: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  cancelRequested: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Everything the runner needs to execute one run (`GET /runner/tasks/claim`). */
export interface ClaimedWork {
  run: RunDto;
  task: {
    id: string;
    intent: TaskIntent;
    source: TaskSource;
    sourceRef?: string;
    prompt: string;
  };
  project: {
    id: string;
    name: string;
    workspaceKey: string;
    defaultBranch: string;
    testCommand?: string;
    buildCommand?: string;
    workspacePath: string;
  };
}

export interface ClaimResponse {
  claimed: boolean;
  work?: ClaimedWork;
}

/** Response shape for `POST /runner/runs/:id/heartbeat`. */
export interface PendingApprovalStatus {
  approvalId: string;
  action: 'shell' | 'push' | 'destructive';
  status: 'pending' | 'approved' | 'denied';
}

export interface RunHeartbeatResponse {
  runId: string;
  status: string;
  cancelRequested: boolean;
  approval?: PendingApprovalStatus;
}

export interface RunEventDto {
  id: string;
  runId: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: string;
}

export type RunEventType = 'status' | 'log' | 'tool' | 'artifact' | 'verification' | 'error';

export interface CompleteRunInput {
  status: 'succeeded' | 'failed' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
  branch?: string;
  worktreePath?: string;
  artifacts?: RunArtifact[];
}

export interface ApprovalDto {
  id: string;
  runId: string;
  action: 'shell' | 'push' | 'destructive';
  status: 'pending' | 'approved' | 'denied';
  summary?: string;
  detail?: unknown;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface RequestApprovalInput {
  action: 'shell' | 'push' | 'destructive';
  summary?: string;
  detail?: Record<string, unknown>;
}

export class RunnerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RunnerApiError';
  }
}

/** Thrown by `register()` when the server reports the token as revoked. */
export class RunnerTokenRevokedError extends RunnerApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'RunnerTokenRevokedError';
  }
}

export interface RunnerClientOptions {
  serverUrl: string;
  runnerToken: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. Default: 10s. */
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Thin HTTP client for the Runner Gateway (`${serverUrl}/runner/...`,
 * docs/architecture.md §9). The runner only ever makes outbound calls — no
 * inbound port is ever opened (docs/requirements.md §3).
 */
export class RunnerClient {
  private readonly baseUrl: string;
  private readonly runnerToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: RunnerClientOptions) {
    this.baseUrl = options.serverUrl.replace(/\/+$/, '');
    this.runnerToken = options.runnerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.runnerToken}`,
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        if (response.status === 401 && /revoked/i.test(bodyText)) {
          throw new RunnerTokenRevokedError(`runner token has been revoked: ${bodyText}`);
        }
        throw new RunnerApiError(
          `${init.method ?? 'GET'} ${path} failed with ${response.status}: ${bodyText}`,
          response.status,
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof RunnerApiError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RunnerApiError(`${init.method ?? 'GET'} ${path} timed out`);
      }
      throw new RunnerApiError(
        `${init.method ?? 'GET'} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Register (or refresh) this runner. Sends `machineName`/`platform`/`version`
   * so the server-side inventory (`GET /runners`) can display them
   * (docs/tasks.md T3.2 "上报 version" / "上报 platform").
   */
  async register(input: {
    name: string;
    machineName?: string;
    platform?: string;
    version?: string;
  }): Promise<RegisteredRunner> {
    return this.request<RegisteredRunner>('/runner/register', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        machineName: input.machineName,
        platform: input.platform ?? platform(),
        version: input.version,
      }),
    });
  }

  /** Idle heartbeat (no run in flight) — keeps the runner marked online. */
  async heartbeat(): Promise<RunnerHeartbeatResponse> {
    return this.request<RunnerHeartbeatResponse>('/runner/heartbeat', { method: 'POST' });
  }

  /**
   * Try to claim the oldest queued run for a project mapped to this runner.
   * `claimed: false` means there is nothing to do right now (empty queue, or
   * this runner already has an in-flight run) — not an error.
   */
  async claim(): Promise<ClaimResponse> {
    return this.request<ClaimResponse>('/runner/tasks/claim', { method: 'GET' });
  }

  /** Append a run event (status/log/tool/artifact/verification/error). */
  async appendEvent(runId: string, type: RunEventType, payload?: unknown): Promise<RunEventDto> {
    return this.request<RunEventDto>(`/runner/runs/${encodeURIComponent(runId)}/events`, {
      method: 'POST',
      body: JSON.stringify({ type, payload }),
    });
  }

  /** Per-run heartbeat — carries the cancellation flag back (architecture §9). */
  async runHeartbeat(runId: string, note?: string): Promise<RunHeartbeatResponse> {
    return this.request<RunHeartbeatResponse>(
      `/runner/runs/${encodeURIComponent(runId)}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify({ note }),
      },
    );
  }

  /**
   * Request approval for a high-risk action (docs/tasks.md T8.3, #37).
   * Transitions the run to `needs_approval`; the caller should then poll
   * `runHeartbeat` until `approval.status` is no longer `pending`.
   */
  async requestApproval(runId: string, input: RequestApprovalInput): Promise<ApprovalDto> {
    return this.request<ApprovalDto>(`/runner/runs/${encodeURIComponent(runId)}/approvals`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Report the terminal outcome of a run. */
  async complete(runId: string, input: CompleteRunInput): Promise<RunDto> {
    return this.request<RunDto>(`/runner/runs/${encodeURIComponent(runId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ ...input, artifacts: input.artifacts ?? [] }),
    });
  }
}
