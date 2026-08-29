import { RunnerApiError, type RunnerClient, RunnerTokenRevokedError } from './runner-client.js';

export type RunnerConnectionState = 'online' | 'offline';

export interface HeartbeatLoopOptions {
  client: RunnerClient;
  intervalMs: number;
  runnerName: string;
  machineName?: string;
  version?: string;
  /** Called whenever the observed connection state changes. */
  onStateChange?: (state: RunnerConnectionState) => void;
  /** Called on every failed register/heartbeat call (logging hook). */
  onError?: (error: unknown) => void;
  /** Called once the runner token is confirmed revoked; the loop stops itself. */
  onRevoked?: (error: RunnerTokenRevokedError) => void;
  /** Test seam: overrides `setInterval`/`clearInterval`. */
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

/**
 * Drives the register → heartbeat loop against the Runner Gateway
 * (docs/tasks.md T3.2, docs/architecture.md §9).
 *
 * `register()` is called once at startup (and again if a heartbeat fails —
 * the server may have restarted / lost in-memory state is not a concern here
 * since state is in MySQL, but re-registering is cheap and self-healing).
 * Heartbeats run on `DEFAULT_HEARTBEAT_INTERVAL_MS` and flip the observed
 * online/offline state based on whether the last call succeeded — this is a
 * client-side mirror of the server's own `isRunnerOnline` derivation, purely
 * for local logging/visibility.
 */
export class HeartbeatLoop {
  private readonly client: RunnerClient;
  private readonly intervalMs: number;
  private readonly runnerName: string;
  private readonly machineName?: string;
  private readonly version?: string;
  private readonly onStateChange?: (state: RunnerConnectionState) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly onRevoked?: (error: RunnerTokenRevokedError) => void;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;

  private timer: ReturnType<typeof setInterval> | null = null;
  private state: RunnerConnectionState = 'offline';
  private stopped = false;

  constructor(options: HeartbeatLoopOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs;
    this.runnerName = options.runnerName;
    this.machineName = options.machineName;
    this.version = options.version;
    this.onStateChange = options.onStateChange;
    this.onError = options.onError;
    this.onRevoked = options.onRevoked;
    this.setIntervalImpl = options.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  }

  get currentState(): RunnerConnectionState {
    return this.state;
  }

  /** Register once, then start the periodic heartbeat. Throws if registration fails. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.client.register({
      name: this.runnerName,
      machineName: this.machineName,
      version: this.version,
    });
    this.setState('online');
    this.timer = this.setIntervalImpl(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
  }

  /** Runs one heartbeat attempt; exposed directly so tests don't need fake timers. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.client.heartbeat();
      this.setState('online');
    } catch (error) {
      if (error instanceof RunnerTokenRevokedError) {
        this.setState('offline');
        this.onRevoked?.(error);
        this.stop();
        return;
      }
      this.setState('offline');
      this.onError?.(error instanceof RunnerApiError ? error : error);
    }
  }

  private setState(next: RunnerConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange?.(next);
  }
}
