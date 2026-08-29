import { spawn } from 'node:child_process';
import type { Readable as NodeReadable } from 'node:stream';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

/** Options for launching the OpenCode ACP subprocess. */
export interface AcpLauncherOptions {
  /** Executable to run, defaults to `opencode`. */
  command?: string;
  /** Extra args appended after the fixed `acp` subcommand. */
  args?: string[];
  /** Environment variables for the subprocess (merged over `process.env`). */
  env?: Record<string, string | undefined>;
  /** Working directory to launch the process in (usually the run's worktree). */
  cwd: string;
}

/**
 * A running ACP-speaking process (or in-process test double) plus its
 * transport stream. Kept independent of `ChildProcess` so unit tests can
 * supply an in-memory `AgentApp` instead of spawning a real binary.
 */
export interface AcpProcessHandle {
  readonly stream: acp.Stream;
  /** Diagnostic-only stderr channel; never used for control flow (§7). */
  readonly stderr: NodeReadable | null;
  /** Resolves once the process has exited. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Kill the process (SIGTERM, escalating to SIGKILL). */
  kill(): Promise<void>;
}

/**
 * Spawns `opencode acp` (or a configured equivalent) bound to `cwd` and wires
 * up an ndjson ACP stream over its stdio.
 *
 * Per docs/requirements.md §7, we never parse TUI stdout — only the ACP
 * JSON-RPC channel on stdin/stdout. stderr is left for diagnostics only and is
 * surfaced via the caller's log sink, never parsed for control flow.
 */
export function launchAcpProcess(options: AcpLauncherOptions): AcpProcessHandle {
  const command = options.command ?? 'opencode';
  const args = [...(options.args ?? []), 'acp'];

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  async function kill(): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([exited.then(() => undefined), timeout]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }

  return { stream, stderr: child.stderr, exited, kill };
}
