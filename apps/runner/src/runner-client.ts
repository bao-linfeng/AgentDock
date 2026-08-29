import { platform } from 'node:os';

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
}
