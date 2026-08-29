import { access } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type {
  ContextPointer,
  PermissionGrant,
  RunArtifact,
  RunStatus,
  VerificationResult,
} from '@agentdock/protocol';
import { redactSecrets } from '@agentdock/shared';
import { type AcpLauncherOptions, type AcpProcessHandle, launchAcpProcess } from './acp-client.js';

export type { AcpLauncherOptions, AcpProcessHandle } from './acp-client.js';
export { launchAcpProcess } from './acp-client.js';

/** Input handed to an executor for a single run. */
export interface ExecutorRunInput {
  runId: string;
  workspaceCwd: string;
  prompt: string;
  context: ContextPointer[];
  permissions: PermissionGrant[];
}

/** Readiness probe result, returned by `canRun`. */
export interface ExecutorReadiness {
  ready: boolean;
  reason?: string;
}

/** Final structured outcome of a run. */
export interface ExecutorRunResult {
  status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>;
  artifacts: RunArtifact[];
  summary?: string;
}

/** Sink through which an executor streams progress back to the runner. */
export interface ExecutorEventSink {
  status(status: RunStatus): Promise<void>;
  log(message: string): Promise<void>;
  artifact(artifact: RunArtifact): Promise<void>;
  verification(result: VerificationResult): Promise<void>;
  /** Bridges a fatal/non-fatal executor-side error (docs/tasks.md T4.3). */
  error(message: string, code?: string): Promise<void>;
}

/** Core executor abstraction. MVP has a single implementation: OpenCode via ACP. */
export interface AgentExecutor {
  readonly id: string;
  canRun(input: ExecutorRunInput): Promise<ExecutorReadiness>;
  run(input: ExecutorRunInput, sink: ExecutorEventSink): Promise<ExecutorRunResult>;
  cancel(runId: string): Promise<void>;
}

/** Options accepted by `OpenCodeExecutor`, beyond the defaults. */
export interface OpenCodeExecutorOptions {
  /** Executable used to launch OpenCode, defaults to `opencode`. */
  command?: string;
  /** Extra args passed before the fixed `acp` subcommand. */
  args?: string[];
  /** Environment overrides forwarded to the subprocess. */
  env?: Record<string, string | undefined>;
  /** Hard wall-clock timeout for a single run, in ms. Default: 30 minutes. */
  timeoutMs?: number;
  /**
   * Test seam: overrides how the ACP subprocess is launched. Defaults to
   * `launchAcpProcess` (spawns the real `opencode acp` binary). Unit tests
   * inject a fake handle backed by an in-process `AgentApp`.
   */
  launch?: (options: AcpLauncherOptions) => AcpProcessHandle;
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000;

/** Tracks the live ACP process + session for a single in-flight run. */
interface ActiveRun {
  handle: AcpProcessHandle;
  sessionId: string;
  /** Resolves once `sessionId` has been assigned (session/new completed). */
  sessionReady: Promise<void>;
  ctx: acp.ClientContext;
  cancelRequested: boolean;
}

/**
 * OpenCode ACP executor.
 *
 * Launches `opencode acp` as a subprocess bound to the run's worktree, drives
 * the ACP client protocol (initialize -> new session -> prompt), and bridges
 * `session/update` notifications to the `ExecutorEventSink` (status / log /
 * artifact / verification / error). Never parses TUI stdout — the ACP
 * JSON-RPC channel is the only source of truth (docs/requirements.md §7).
 */
export class OpenCodeExecutor implements AgentExecutor {
  readonly id = 'opencode';

  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string | undefined>;
  private readonly timeoutMs: number;
  private readonly launch: (options: AcpLauncherOptions) => AcpProcessHandle;
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(options: OpenCodeExecutorOptions = {}) {
    this.command = options.command ?? 'opencode';
    this.args = options.args ?? [];
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.launch = options.launch ?? launchAcpProcess;
  }

  async canRun(input: ExecutorRunInput): Promise<ExecutorReadiness> {
    if (!input.workspaceCwd || !isAbsolute(input.workspaceCwd)) {
      return {
        ready: false,
        reason: `workspaceCwd must be an absolute path: ${input.workspaceCwd}`,
      };
    }
    try {
      await access(input.workspaceCwd);
    } catch {
      return { ready: false, reason: `workspaceCwd does not exist: ${input.workspaceCwd}` };
    }
    return { ready: true };
  }

  async run(input: ExecutorRunInput, sink: ExecutorEventSink): Promise<ExecutorRunResult> {
    const readiness = await this.canRun(input);
    if (!readiness.ready) {
      await sink.error(readiness.reason ?? 'executor not ready', 'not_ready');
      return { status: 'failed', artifacts: [], summary: readiness.reason };
    }

    const handle = this.launch({
      command: this.command,
      args: this.args,
      env: this.env,
      cwd: input.workspaceCwd,
    });

    this.pipeStderr(handle, sink);

    const clientApp = acp.client({ name: 'agentdock-runner' });
    registerClientHandlers(clientApp, sink);

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void this.cancel(input.runId);
    }, this.timeoutMs);

    try {
      const result = await clientApp.connectWith(handle.stream, async (ctx) => {
        let resolveSessionReady!: () => void;
        const sessionReady = new Promise<void>((resolve) => {
          resolveSessionReady = resolve;
        });
        this.activeRuns.set(input.runId, {
          handle,
          sessionId: '',
          sessionReady,
          ctx,
          cancelRequested: false,
        });

        try {
          await ctx.request(acp.AGENT_METHODS.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
          });

          const session = await ctx.buildSession(input.workspaceCwd).start();
          const active = this.activeRuns.get(input.runId);
          if (active) active.sessionId = session.sessionId;
          resolveSessionReady();

          await sink.status('running');

          const promptText = buildPromptText(input.prompt, input.context);
          const promptPromise = session.prompt(promptText);

          // Drain session updates until the prompt turn completes.
          let stopReason: acp.StopReason | undefined;
          while (stopReason === undefined) {
            const message = await session.nextUpdate();
            if (message.kind === 'stop') {
              stopReason = message.stopReason;
              break;
            }
            await bridgeSessionUpdate(message.update, sink);
          }
          await promptPromise;

          return mapStopReasonToResult(stopReason);
        } finally {
          // Unblocks any pending `cancel()` even if session setup failed.
          resolveSessionReady();
        }
      });

      if (timedOut) {
        await sink.error('run timed out and was cancelled', 'timeout');
        return { status: 'cancelled', artifacts: [], summary: 'Run timed out' };
      }
      return result;
    } catch (error) {
      if (timedOut) {
        await sink.error('run timed out and was cancelled', 'timeout');
        return { status: 'cancelled', artifacts: [], summary: 'Run timed out' };
      }
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      await sink.error(message, 'acp_error');
      return { status: 'failed', artifacts: [], summary: message };
    } finally {
      clearTimeout(timeout);
      this.activeRuns.delete(input.runId);
      await handle.kill();
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    if (active.cancelRequested) return;
    active.cancelRequested = true;
    await active.sessionReady;
    if (!active.sessionId) {
      // Session never got established — killing the process is the only option.
      await active.handle.kill();
      return;
    }
    try {
      await active.ctx.notify(acp.AGENT_METHODS.session_cancel, { sessionId: active.sessionId });
    } catch {
      // Best-effort: fall back to killing the process if the notify fails.
      await active.handle.kill();
    }
  }

  private pipeStderr(handle: AcpProcessHandle, sink: ExecutorEventSink): void {
    if (!handle.stderr) return;
    handle.stderr.setEncoding('utf8');
    handle.stderr.on('data', (chunk: string) => {
      const redacted = redactSecrets(chunk).trim();
      if (redacted) void sink.log(redacted);
    });
  }
}

/** Render prompt + context pointers into a single ACP text block. */
function buildPromptText(prompt: string, context: ContextPointer[]): string {
  if (context.length === 0) return prompt;
  const contextLines = context.map(
    (c) => `- [${c.kind}] ${c.ref}${c.label ? ` (${c.label})` : ''}`,
  );
  return `${prompt}\n\nContext:\n${contextLines.join('\n')}`;
}

function mapStopReasonToResult(stopReason: acp.StopReason | undefined): ExecutorRunResult {
  switch (stopReason) {
    case 'end_turn':
      return { status: 'succeeded', artifacts: [] };
    case 'cancelled':
      return { status: 'cancelled', artifacts: [] };
    default:
      return {
        status: 'failed',
        artifacts: [],
        summary: stopReason ? `stopped: ${stopReason}` : 'stopped: unknown',
      };
  }
}

/** Registers the ACP client-side handlers required by OpenCode over ACP. */
function registerClientHandlers(clientApp: acp.ClientApp, sink: ExecutorEventSink): acp.ClientApp {
  return clientApp
    .onRequest(acp.CLIENT_METHODS.session_request_permission, async ({ params }) => {
      // MVP: no interactive approval UI wired yet (docs/tasks.md T8.3). Deny by
      // default so the agent cannot silently perform high-risk actions.
      await sink.log(`permission requested: ${JSON.stringify(params.toolCall?.title ?? params)}`);
      const firstOption = params.options[0];
      return {
        outcome: firstOption
          ? { outcome: 'selected' as const, optionId: firstOption.optionId }
          : { outcome: 'cancelled' as const },
      };
    })
    .onRequest(acp.CLIENT_METHODS.fs_read_text_file, async () => {
      throw new Error('fs.readTextFile not supported: client capability disabled');
    })
    .onRequest(acp.CLIENT_METHODS.fs_write_text_file, async () => {
      throw new Error('fs.writeTextFile not supported: client capability disabled');
    });
}

/** Bridges a single ACP `SessionUpdate` to the executor event sink. */
async function bridgeSessionUpdate(
  update: acp.SessionUpdate,
  sink: ExecutorEventSink,
): Promise<void> {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
    case 'user_message_chunk': {
      const text = contentBlockToText(update.content);
      if (text) await sink.log(redactSecrets(text));
      return;
    }
    case 'tool_call': {
      await sink.log(
        redactSecrets(
          `tool_call[${update.toolCallId}] ${update.title} (${update.status ?? 'pending'})`,
        ),
      );
      return;
    }
    case 'tool_call_update': {
      const summary = summarizeToolCallContent(update.content);
      await sink.log(
        redactSecrets(
          `tool_call_update[${update.toolCallId}] ${update.status ?? ''} ${summary}`.trim(),
        ),
      );
      if (update.status === 'failed') {
        await sink.error(`tool call ${update.toolCallId} failed`, 'tool_call_failed');
      }
      return;
    }
    case 'plan':
    case 'plan_update':
    case 'plan_removed':
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
    case 'usage_update':
    case 'compaction_update':
    case 'compaction_summary_chunk':
      // Informational only for the MVP — not part of the required event
      // bridge (status/log/artifact/verification/error).
      return;
    default:
      return;
  }
}

function contentBlockToText(content: acp.ContentBlock | undefined): string | undefined {
  if (!content) return undefined;
  if (content.type === 'text') return content.text;
  return undefined;
}

function summarizeToolCallContent(content: acp.ToolCallContent[] | null | undefined): string {
  if (!content || content.length === 0) return '';
  return content
    .map((item) => {
      if (item.type === 'content') return contentBlockToText(item.content) ?? '';
      return '';
    })
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}
