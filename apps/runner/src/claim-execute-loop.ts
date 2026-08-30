import { isAbsolute, resolve } from 'node:path';
import type { AgentExecutor, ExecutorEventSink } from '@agentdock/agent-runtime';
import {
  GitRuntimeError,
  WorktreeManager,
  agentBranchName,
  runVerification,
} from '@agentdock/git-runtime';
import { decideCompletion, withProjectRules } from '@agentdock/governance';
import type { RunArtifact, RunStatus } from '@agentdock/protocol';
import type { PushConfig } from './config.js';
import type { ClaimedWork, RunnerClient } from './runner-client.js';

export interface ClaimExecuteLoopOptions {
  client: RunnerClient;
  /** Poll interval for `GET /runner/tasks/claim` while idle, in ms. */
  pollIntervalMs: number;
  /** How often to send the per-run heartbeat (and pick up cancellation), in ms. */
  runHeartbeatIntervalMs?: number;
  executor: AgentExecutor;
  /** Commit message template; `{taskId}` / `{runId}` are substituted. */
  commitMessageTemplate?: string;
  /**
   * Looks up the local push configuration for a claimed project (keyed by the
   * server project id — the same key as `RunnerConfig.projects`). Returns
   * `undefined`/`{ enabled: false }` to keep the previous commit-only
   * behavior (docs/tasks.md T5.4, #27).
   */
  getPushConfig?: (projectId: string) => PushConfig | undefined;
  /**
   * Approval gate for pushing the agent branch (docs/tasks.md T8.3, #37).
   * When omitted, a push proceeds without an approval gate (pre-#37
   * behavior) — set this once a project's `push.requireApproval` is enabled.
   */
  requestPushApproval?: (
    runId: string,
    summary: string,
    detail?: unknown,
  ) => Promise<'approved' | 'denied'>;
  /**
   * Local root-containment gate for the server-supplied `workspacePath`
   * (docs/architecture.md §14; #75). The Control Server never touches the
   * local filesystem, so the Runner is the last line of defense against a
   * claim response that names a path outside the operator's configured
   * `allowedRoots` (or a path that doesn't exist / isn't a git repo). Must
   * throw to reject the claimed work; the loop completes the run as
   * `failed` with `errorCode: 'workspace_not_allowed'`. When omitted, no
   * local check is performed beyond the existing absolute-path assertion.
   */
  assertWorkspaceAllowed?: (projectId: string, workspacePath: string) => Promise<void>;
  onLog?: (message: string) => void;
  onError?: (error: unknown) => void;
  /** Test seam: overrides `setInterval`/`clearInterval`/`setTimeout`/`clearTimeout`. */
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
}

const DEFAULT_RUN_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_COMMIT_MESSAGE_TEMPLATE = 'agentdock: {taskId}';

/** Raised when the runner-side cancellation flag is observed mid-run. */
class RunCancelledError extends Error {
  constructor(runId: string) {
    super(`run ${runId} was cancelled`);
    this.name = 'RunCancelledError';
  }
}

/**
 * Raised when the server-supplied `workspacePath` fails the local
 * root-containment / existence / git-repo check (#75). Caught separately so
 * the run completes as `failed` with a stable `errorCode` instead of the
 * generic `runner_error`.
 */
class WorkspaceNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceNotAllowedError';
  }
}

/**
 * Drives the claim -> worktree -> executor -> verify -> commit -> complete
 * pipeline against the Runner Gateway (docs/tasks.md T3.4b, architecture §9/§10).
 *
 * Single runner, one run at a time (confirmed decision): `tick()` only ever
 * attempts a new claim when no run is currently executing. Cancellation is
 * cooperative — a background per-run heartbeat polls `cancelRequested` and a
 * flag is checked between pipeline stages and inside the event sink, so an
 * in-flight executor is asked to `cancel()` rather than killed outright.
 */
export class ClaimExecuteLoop {
  private readonly client: RunnerClient;
  private readonly pollIntervalMs: number;
  private readonly runHeartbeatIntervalMs: number;
  private readonly executor: AgentExecutor;
  private readonly commitMessageTemplate: string;
  private readonly getPushConfig: (projectId: string) => PushConfig | undefined;
  private readonly requestPushApproval?: (
    runId: string,
    summary: string,
    detail?: unknown,
  ) => Promise<'approved' | 'denied'>;
  private readonly assertWorkspaceAllowed?: (
    projectId: string,
    workspacePath: string,
  ) => Promise<void>;
  private readonly onLog: (message: string) => void;
  private readonly onError: (error: unknown) => void;
  private readonly setIntervalImpl: typeof setInterval;
  private readonly clearIntervalImpl: typeof clearInterval;

  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;

  constructor(options: ClaimExecuteLoopOptions) {
    this.client = options.client;
    this.pollIntervalMs = options.pollIntervalMs;
    this.runHeartbeatIntervalMs =
      options.runHeartbeatIntervalMs ?? DEFAULT_RUN_HEARTBEAT_INTERVAL_MS;
    this.executor = options.executor;
    this.commitMessageTemplate = options.commitMessageTemplate ?? DEFAULT_COMMIT_MESSAGE_TEMPLATE;
    this.getPushConfig = options.getPushConfig ?? (() => undefined);
    this.requestPushApproval = options.requestPushApproval;
    this.assertWorkspaceAllowed = options.assertWorkspaceAllowed;
    this.onLog = options.onLog ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.setIntervalImpl = options.setIntervalImpl ?? setInterval;
    this.clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
  }

  start(): void {
    this.stopped = false;
    this.timer = this.setIntervalImpl(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** One poll attempt: claim if idle, then run the full pipeline to completion. */
  async tick(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      const response = await this.client.claim();
      if (!response.claimed || !response.work) return;
      await this.executeClaimedWork(response.work);
    } catch (error) {
      this.onError(error);
    } finally {
      this.busy = false;
    }
  }

  private async executeClaimedWork(work: ClaimedWork): Promise<void> {
    const runId = work.run.id;
    const heartbeat = this.startRunHeartbeat(runId);

    try {
      const workspacePath = resolve(work.project.workspacePath);
      if (!isAbsolute(workspacePath)) {
        throw new GitRuntimeError(`workspacePath must be absolute: ${work.project.workspacePath}`);
      }

      if (this.assertWorkspaceAllowed) {
        try {
          await this.assertWorkspaceAllowed(work.project.id, workspacePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new WorkspaceNotAllowedError(message);
        }
      }

      const worktreeMgr = new WorktreeManager(workspacePath);
      const branch = agentBranchName(work.task.id, work.task.prompt);

      const sink = this.buildEventSink(runId, heartbeat);

      await this.reportStatus(runId, 'running');

      const worktree = await worktreeMgr.create(runId, work.project.defaultBranch, branch);
      heartbeat.throwIfCancelled(runId);

      const readiness = await this.executor.canRun({
        runId,
        workspaceCwd: worktree.worktreePath,
        prompt: work.task.prompt,
        context: work.task.sourceRef
          ? [{ kind: 'text' as const, ref: work.task.sourceRef, label: 'source' }]
          : [],
        permissions: [],
      });
      if (!readiness.ready) {
        await this.finishFailed(
          runId,
          'not_ready',
          readiness.reason ?? 'executor not ready',
          worktree.branch,
          worktree.worktreePath,
        );
        await this.cleanup(worktreeMgr, worktree);
        return;
      }

      const result = await this.executor.run(
        {
          runId,
          workspaceCwd: worktree.worktreePath,
          prompt: work.task.prompt,
          context: work.task.sourceRef
            ? [{ kind: 'text' as const, ref: work.task.sourceRef, label: 'source' }]
            : [],
          permissions: [],
        },
        sink,
      );
      heartbeat.throwIfCancelled(runId);

      if (result.status === 'cancelled') {
        await this.finishTerminal(runId, 'cancelled', [], worktree.branch, worktree.worktreePath);
        await this.cleanup(worktreeMgr, worktree);
        return;
      }
      if (result.status === 'failed') {
        await this.finishFailed(
          runId,
          'executor_failed',
          result.summary ?? 'executor reported failure',
          worktree.branch,
          worktree.worktreePath,
        );
        await this.cleanup(worktreeMgr, worktree);
        return;
      }

      await this.reportStatus(runId, 'verifying');
      const artifacts = [...result.artifacts];

      const changes = await worktreeMgr.detectChanges(worktree);
      if (changes.hasChanges) {
        artifacts.push({
          type: 'diff',
          title: `${changes.changedFiles.length} file(s) changed`,
          metadata: {
            changedFiles: changes.changedFiles,
            insertions: changes.insertions,
            deletions: changes.deletions,
          },
        });
      }

      if (work.project.testCommand) {
        const verification = await runVerification({
          cwd: worktree.worktreePath,
          command: work.project.testCommand,
        });
        await sink.verification(verification);
        artifacts.push({
          type: 'test_result',
          title: verification.passed ? 'tests passed' : 'tests failed',
          metadata: { ...verification },
        });
        if (!verification.passed) {
          await this.finishFailed(
            runId,
            'verification_failed',
            `test command failed: ${verification.command}`,
            worktree.branch,
            worktree.worktreePath,
            artifacts,
          );
          await this.cleanup(worktreeMgr, worktree);
          return;
        }
      }
      heartbeat.throwIfCancelled(runId);

      await this.reportStatus(runId, 'publishing');
      const commitMessage = this.commitMessageTemplate
        .replace('{taskId}', work.task.id)
        .replace('{runId}', runId);
      const sha = await worktreeMgr.commit(worktree, commitMessage);
      if (sha) {
        artifacts.push({
          type: 'commit',
          title: commitMessage,
          metadata: { sha, branch: worktree.branch },
        });

        const pushConfig = this.getPushConfig(work.project.id);
        if (pushConfig?.enabled) {
          const pushSummary = `push ${worktree.branch} to ${pushConfig.remote}`;
          let approvedToPush = true;
          if (pushConfig.requireApproval) {
            if (!this.requestPushApproval) {
              this.onLog(
                `push skipped: requireApproval is set but no approval gate is configured (${pushSummary})`,
              );
              approvedToPush = false;
            } else {
              await this.reportStatus(runId, 'needs_approval');
              const decision = await this.requestPushApproval(runId, pushSummary, {
                branch: worktree.branch,
                remote: pushConfig.remote,
              });
              approvedToPush = decision === 'approved';
              if (!approvedToPush) {
                this.onLog(`push denied by approval gate: ${pushSummary}`);
              } else {
                await this.reportStatus(runId, 'publishing');
              }
            }
          }

          if (approvedToPush) {
            try {
              const pushResult = await worktreeMgr.push(worktree, {
                remote: pushConfig.remote,
                protectedBranches: pushConfig.protectedBranches,
              });
              if (pushResult.pushed) {
                artifacts.push({
                  type: 'commit',
                  title: `pushed ${pushResult.branch} to ${pushResult.remote}`,
                  metadata: {
                    sha,
                    branch: pushResult.branch,
                    remote: pushResult.remote,
                    pushed: true,
                  },
                });
              } else {
                this.onLog(`push skipped: ${pushResult.reason ?? 'unknown reason'}`);
              }
            } catch (error) {
              // A refused/failed push must not silently look like success — log
              // it and let evidence rules (missing `pull_request`) surface the
              // gap rather than throwing away the run's other artifacts.
              this.onError(error);
              this.onLog(`push failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
      }

      const decision = decideCompletion(
        work.task.intent,
        artifacts,
        // Per-project evidence rules come down with the claim (#60); fall back
        // to the built-in defaults when the project has no override.
        withProjectRules(work.project.evidenceRules ?? {}),
      );
      if (decision.status === 'failed') {
        await this.finishFailed(
          runId,
          'evidence_incomplete',
          `missing required evidence: ${decision.missing.join(', ')}`,
          worktree.branch,
          worktree.worktreePath,
          artifacts,
        );
      } else {
        await this.finishTerminal(
          runId,
          'succeeded',
          artifacts,
          worktree.branch,
          worktree.worktreePath,
        );
      }
      await this.cleanup(worktreeMgr, worktree);
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await this.executor.cancel(runId).catch(() => {});
        await this.finishTerminal(runId, 'cancelled', []);
      } else if (error instanceof WorkspaceNotAllowedError) {
        this.onError(error);
        await this.finishFailed(runId, 'workspace_not_allowed', error.message);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.onError(error);
        await this.finishFailed(runId, 'runner_error', message);
      }
    } finally {
      heartbeat.stop();
    }
  }

  private async cleanup(
    mgr: WorktreeManager,
    worktree: { worktreePath: string; runId: string; branch: string; baseBranch: string },
  ): Promise<void> {
    try {
      await mgr.cleanup(worktree);
    } catch (error) {
      this.onError(error);
    }
  }

  private async reportStatus(runId: string, status: RunStatus): Promise<void> {
    await this.client.appendEvent(runId, 'status', { status });
  }

  private async finishTerminal(
    runId: string,
    status: 'succeeded' | 'cancelled',
    artifacts: RunArtifact[],
    branch?: string,
    worktreePath?: string,
  ): Promise<void> {
    await this.client.complete(runId, { status, branch, worktreePath, artifacts });
  }

  private async finishFailed(
    runId: string,
    errorCode: string,
    errorMessage: string,
    branch?: string,
    worktreePath?: string,
    artifacts: RunArtifact[] = [],
  ): Promise<void> {
    await this.client.complete(runId, {
      status: 'failed',
      errorCode,
      errorMessage,
      branch,
      worktreePath,
      artifacts,
    });
  }

  private buildEventSink(runId: string, heartbeat: RunHeartbeatController): ExecutorEventSink {
    const client = this.client;
    const onLog = this.onLog;
    return {
      async status(status) {
        await client.appendEvent(runId, 'status', { status });
      },
      async log(message) {
        onLog(message);
        await client.appendEvent(runId, 'log', { message });
      },
      async artifact(artifact) {
        await client.appendEvent(runId, 'artifact', artifact);
      },
      async verification(result) {
        await client.appendEvent(runId, 'verification', result);
      },
      async error(message, code) {
        await client.appendEvent(runId, 'error', { message, code });
      },
    };
  }

  /** Starts a background per-run heartbeat that tracks the cancellation flag. */
  private startRunHeartbeat(runId: string): RunHeartbeatController {
    let cancelRequested = false;
    const poll = async () => {
      try {
        const response = await this.client.runHeartbeat(runId);
        cancelRequested = response.cancelRequested;
      } catch (error) {
        this.onError(error);
      }
    };
    const timer = this.setIntervalImpl(() => {
      void poll();
    }, this.runHeartbeatIntervalMs);
    return {
      stop: () => this.clearIntervalImpl(timer),
      throwIfCancelled: (id: string) => {
        if (cancelRequested) throw new RunCancelledError(id);
      },
    };
  }
}

interface RunHeartbeatController {
  stop(): void;
  throwIfCancelled(runId: string): void;
}
