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
  /**
   * Set once the underlying `ChildProcess` emits `'error'` (e.g. the binary
   * genuinely doesn't exist). Callers should check this before relying on
   * `stream` — the process never started, so `stream` is not usable (#71).
   */
  readonly spawnError?: Error;
  /** Kill the process (SIGTERM, escalating to SIGKILL). */
  kill(): Promise<void>;
}

/**
 * Windows exposes the PATH variable under inconsistent casing depending on
 * how the parent process/shell was launched (commonly `Path`, sometimes
 * `PATH`). Node resolves `process.env.PATH` case-insensitively when it
 * inherits the environment untouched, but once we hand `spawn` a *custom*
 * `env` object (as we do here to merge in `options.env`), Windows' underlying
 * `CreateProcess` call needs an actual `PATH` key — a `Path`-only env block
 * makes `cmd.exe` (used via `shell: true`) unable to resolve the `opencode`
 * `.cmd` shim, so `spawn` fails with `ENOENT` (#71).
 */
function normalizeWindowsPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'win32' || env.PATH) return env;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  if (!pathKey) return env;
  return { ...env, PATH: env[pathKey] };
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
  const env = normalizeWindowsPath({ ...process.env, ...options.env } as NodeJS.ProcessEnv);

  const child = spawn(command, args, {
    cwd: options.cwd,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    // On Windows, npm/pnpm-installed CLIs (e.g. `opencode`) are shell shims
    // (`.cmd`/`.bat`), which `child_process.spawn` cannot exec directly
    // without a shell (fails with EINVAL/ENOENT) — see
    // https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows.
    // `shell: true` is safe here: `command`/`args` come from local executor
    // config (OpenCodeExecutorOptions), not untrusted user input, and Node
    // quotes each argv entry for us on Windows.
    shell: process.platform === 'win32',
  });

  // A spawn failure (e.g. the binary genuinely missing) emits an 'error'
  // event; without a listener Node throws and crashes the whole Runner
  // process (#71). Track it on the handle instead so callers can fail the
  // run normally rather than crash the process and have it misreported as
  // `runner_disconnected` once the crashed runner's heartbeat goes stale.
  const handle: { spawnError?: Error } = {};
  child.on('error', (error) => {
    handle.spawnError = error;
  });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    // Treat a spawn failure as an immediate "exit" (code null) rather than
    // rejecting — `exited` is meant to be awaited passively by callers (e.g.
    // in `finally` blocks), and an unhandled rejection would crash the
    // process just like the unhandled 'error' event did.
    child.once('error', () => resolve({ code: null, signal: null }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  async function kill(): Promise<void> {
    if (handle.spawnError || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([exited, timeout]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }

  return {
    stream,
    stderr: child.stderr,
    exited,
    kill,
    get spawnError() {
      return handle.spawnError;
    },
  };
}
