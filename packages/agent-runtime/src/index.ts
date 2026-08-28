import type {
  ContextPointer,
  PermissionGrant,
  RunArtifact,
  RunStatus,
  VerificationResult,
} from '@agentdock/protocol';

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
}

/** Core executor abstraction. MVP has a single implementation: OpenCode via ACP. */
export interface AgentExecutor {
  readonly id: string;
  canRun(input: ExecutorRunInput): Promise<ExecutorReadiness>;
  run(input: ExecutorRunInput, sink: ExecutorEventSink): Promise<ExecutorRunResult>;
  cancel(runId: string): Promise<void>;
}

/**
 * OpenCode ACP executor — STUB.
 *
 * TODO(M0/T0.1): validate the ACP smoke test path first (start `opencode acp`,
 * submit a prompt over JSON-RPC/stdio, receive structured progress, cancel).
 * TODO(M4/T4.2): implement launcher, cwd binding, prompt submission, progress
 * bridging, cancellation and timeout. Confirmed decision: pure OpenCode ACP,
 * no oh-my-opencode-slim for MVP.
 */
export class OpenCodeExecutor implements AgentExecutor {
  readonly id = 'opencode';

  async canRun(_input: ExecutorRunInput): Promise<ExecutorReadiness> {
    return { ready: false, reason: 'OpenCodeExecutor not implemented yet (M4/T4.2)' };
  }

  async run(_input: ExecutorRunInput, _sink: ExecutorEventSink): Promise<ExecutorRunResult> {
    throw new Error('OpenCodeExecutor.run not implemented yet (M4/T4.2)');
  }

  async cancel(_runId: string): Promise<void> {
    throw new Error('OpenCodeExecutor.cancel not implemented yet (M4/T4.2)');
  }
}
