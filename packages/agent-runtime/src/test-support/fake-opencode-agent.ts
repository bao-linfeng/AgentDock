/**
 * In-process fake OpenCode ACP agent used by unit tests.
 *
 * Talks real ACP (via `@agentclientprotocol/sdk`'s `agent()`/`AgentApp`) but
 * skips spawning a subprocess: the test wires an in-memory `Stream` pair
 * directly to `OpenCodeExecutor` in place of `launchAcpProcess`.
 */
import { PassThrough } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import type { AcpProcessHandle } from '../acp-client.js';

/** Scripted behavior for the fake agent's `session/prompt` handler. */
export interface FakeAgentScript {
  /** Session updates to emit (in order) before responding to the prompt. */
  updates?: acp.SessionUpdate[];
  /** Final stop reason returned from `session/prompt`. Default: `end_turn`. */
  stopReason?: acp.StopReason;
  /** If set, `session/prompt` throws this error instead of responding. */
  promptError?: Error;
  /** Delay (ms) before responding, to give tests a window to call `cancel()`. */
  delayMs?: number;
  /** Called with the raw prompt content blocks received by `session/prompt`. */
  onPrompt?: (prompt: acp.ContentBlock[]) => void;
  /**
   * If set, the agent calls `session/request_permission` before responding
   * to the prompt, and this callback observes the outcome the client (test
   * subject) returned.
   */
  requestPermission?: {
    toolCallTitle: string;
    onOutcome?: (outcome: acp.RequestPermissionOutcome) => void;
  };
}

export interface FakeAgentHandle {
  readonly handle: AcpProcessHandle;
  readonly app: acp.AgentApp;
  /** Resolves with the sessionId once `session/new` has been handled. */
  sessionIdPromise: Promise<string>;
  /** True once the agent observed a `session/cancel` notification. */
  cancelReceived(): boolean;
  killCount(): number;
}

/**
 * Builds a fake ACP agent + a compatible `AcpProcessHandle` for injection via
 * `OpenCodeExecutorOptions.launch`.
 */
export function createFakeOpenCodeAgent(script: FakeAgentScript = {}): FakeAgentHandle {
  let resolveSessionId!: (id: string) => void;
  const sessionIdPromise = new Promise<string>((resolve) => {
    resolveSessionId = resolve;
  });

  let cancelled = false;
  let kills = 0;

  const app = acp
    .agent({ name: 'fake-opencode' })
    .onRequest(acp.AGENT_METHODS.initialize, async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(acp.AGENT_METHODS.session_new, async () => {
      const sessionId = 'sess_fake_1';
      resolveSessionId(sessionId);
      return { sessionId };
    })
    .onRequest(acp.AGENT_METHODS.session_prompt, async ({ params, client }) => {
      script.onPrompt?.(params.prompt);
      if (script.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, script.delayMs));
      }
      if (script.promptError) throw script.promptError;

      for (const update of script.updates ?? []) {
        await client.notify(acp.CLIENT_METHODS.session_update, {
          sessionId: params.sessionId,
          update,
        });
      }

      if (script.requestPermission) {
        const outcome = await client.request(acp.CLIENT_METHODS.session_request_permission, {
          sessionId: params.sessionId,
          toolCall: {
            toolCallId: 'permission-tool',
            title: script.requestPermission.toolCallTitle,
          },
          options: [
            { kind: 'allow_once' as const, name: 'Allow once', optionId: 'allow' },
            { kind: 'reject_once' as const, name: 'Reject once', optionId: 'reject' },
          ],
        });
        script.requestPermission.onOutcome?.(outcome.outcome);
      }

      if (cancelled) {
        return { stopReason: 'cancelled' as const };
      }
      return { stopReason: script.stopReason ?? ('end_turn' as const) };
    })
    .onNotification(acp.AGENT_METHODS.session_cancel, async () => {
      cancelled = true;
    });

  // Two in-memory message streams, cross-wired so writes on one side surface
  // as reads on the other (a loopback pair).
  const toAgent = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const toClient = new TransformStream<acp.AnyMessage, acp.AnyMessage>();

  const agentStream: acp.Stream = { writable: toClient.writable, readable: toAgent.readable };
  const clientStream: acp.Stream = { writable: toAgent.writable, readable: toClient.readable };

  app.connect(agentStream);

  const stderr = new PassThrough();
  let exitResolve!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    exitResolve = resolve;
  });

  const handle: AcpProcessHandle = {
    stream: clientStream,
    stderr,
    exited,
    kill: async () => {
      kills += 1;
      exitResolve({ code: 0, signal: null });
    },
  };

  return {
    handle,
    app,
    sessionIdPromise,
    cancelReceived: () => cancelled,
    killCount: () => kills,
  };
}
