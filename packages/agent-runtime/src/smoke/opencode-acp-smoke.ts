/**
 * OpenCode ACP smoke test (docs/tasks.md T0.1, #16).
 *
 * Proves the OpenCode ACP path is viable end-to-end against the *real*
 * `opencode acp` binary — as opposed to `index.test.ts`, which exercises
 * `OpenCodeExecutor` against an in-memory fake agent only. This script is a
 * manual/CI-optional smoke test (not part of `pnpm test`), because it
 * requires a real `opencode` binary on PATH plus configured model
 * credentials (`opencode providers login`).
 *
 * Run with:
 *   pnpm --filter @agentdock/agent-runtime exec tsx src/smoke/opencode-acp-smoke.ts
 *
 * Optional env vars:
 *   SMOKE_OPENCODE_COMMAND Override the `opencode` executable path.
 *
 * Note: `opencode acp` has no `--model` CLI flag — model selection happens
 * inside the ACP session, not via CLI args — so this script relies on
 * whatever default provider/model is configured locally
 * (`opencode providers login`).
 *
 * Checks covered (mirrors the issue's acceptance criteria):
 *   1. Node can launch OpenCode ACP (real subprocess, not a mock)
 *   2. workspaceCwd can be specified and is honored
 *   3. A simple prompt can be submitted
 *   4. Structured progress is received (status + log events via the sink)
 *   5. A final structured result is received
 *   6. A run can be cancelled
 *   7. No TUI stdout parser is involved — only the ACP JSON-RPC channel
 *      (structurally guaranteed: this script only calls the same
 *      `OpenCodeExecutor` / `launchAcpProcess` code path used in production,
 *      which never reads child.stdout directly — see acp-client.ts)
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunArtifact, RunStatus, VerificationResult } from '@agentdock/protocol';
import { OpenCodeExecutor } from '../index.js';

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const checks: CheckResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  checks.push({ name, passed, detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Sink that logs to the console and records what it observed. */
function createObservingSink() {
  const statuses: RunStatus[] = [];
  const logs: string[] = [];
  const artifacts: RunArtifact[] = [];
  const verifications: VerificationResult[] = [];
  const errors: Array<{ message: string; code?: string }> = [];

  return {
    statuses,
    logs,
    artifacts,
    verifications,
    errors,
    sink: {
      async status(status: RunStatus) {
        statuses.push(status);
        console.log(`  [status] ${status}`);
      },
      async log(message: string) {
        logs.push(message);
        console.log(`  [log] ${message.slice(0, 200)}`);
      },
      async artifact(artifact: RunArtifact) {
        artifacts.push(artifact);
        console.log(`  [artifact] ${artifact.type}`);
      },
      async verification(result: VerificationResult) {
        verifications.push(result);
        console.log(`  [verification] ${JSON.stringify(result)}`);
      },
      async error(message: string, code?: string) {
        errors.push({ message, code });
        console.log(`  [error] (${code ?? 'unknown'}) ${message.slice(0, 200)}`);
      },
    },
  };
}

async function runHappyPathCheck(workspaceCwd: string): Promise<void> {
  console.log('\n=== Scenario 1: simple prompt -> structured progress -> final result ===');
  const executor = new OpenCodeExecutor({
    command: process.env.SMOKE_OPENCODE_COMMAND,
    timeoutMs: 5 * 60_000,
  });
  const { sink, statuses, logs, errors } = createObservingSink();

  const readiness = await executor.canRun({
    runId: 'smoke_happy',
    workspaceCwd,
    prompt: 'ping',
    context: [],
    permissions: [],
  });
  record('workspaceCwd accepted by canRun', readiness.ready, readiness.reason);

  const result = await executor.run(
    {
      runId: 'smoke_happy',
      workspaceCwd,
      prompt: 'Reply with the single word "pong" and do not read, write, or modify any files.',
      context: [],
      permissions: [],
    },
    sink,
  );

  record(
    'ACP subprocess launched and produced structured progress',
    logs.length > 0 || statuses.length > 0,
    `statuses=${statuses.join(',')} logCount=${logs.length}`,
  );
  record(
    'received a final structured result',
    result.status !== undefined,
    `status=${result.status}`,
  );
  record(
    'run completed without an unexpected executor error',
    result.status === 'succeeded' || errors.every((e) => e.code !== 'acp_error'),
    `finalStatus=${result.status} errorCodes=${errors.map((e) => e.code).join(',')}`,
  );
}

async function runCancelCheck(workspaceCwd: string): Promise<void> {
  console.log('\n=== Scenario 2: cancel an in-flight run ===');
  const executor = new OpenCodeExecutor({
    command: process.env.SMOKE_OPENCODE_COMMAND,
    timeoutMs: 5 * 60_000,
  });
  const { sink: baseSink } = createObservingSink();

  // Cancel as soon as the very first progress event arrives, rather than
  // racing a fixed delay against the model — free/fast models can finish an
  // entire turn in well under a second, so a timer-based cancel is not
  // reliable. Reacting to the first observed event deterministically hits
  // the "turn not yet finished" window.
  let cancelTriggered = false;
  const sink: typeof baseSink = {
    ...baseSink,
    async log(message) {
      await baseSink.log(message);
      if (!cancelTriggered) {
        cancelTriggered = true;
        await executor.cancel('smoke_cancel');
      }
    },
  };

  const result = await executor.run(
    {
      runId: 'smoke_cancel',
      workspaceCwd,
      prompt:
        'Write a very long, detailed, multi-page essay about the history of distributed systems.',
      context: [],
      permissions: [],
    },
    sink,
  );

  record(
    'cancel() resolves and the run reports a terminal (non-hanging) result',
    result.status === 'cancelled' || result.status === 'succeeded' || result.status === 'failed',
    `status=${result.status}`,
  );
  record(
    'cancelling right after the first progress event actually stops the run (cancelled, not run to completion)',
    result.status === 'cancelled',
    `status=${result.status} cancelTriggered=${cancelTriggered}`,
  );
}

async function rmWithRetry(path: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (i === attempts - 1) {
        console.warn(`Warning: failed to clean up ${path}: ${(error as Error).message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

async function main(): Promise<void> {
  const workspaceCwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-smoke-'));
  await writeFile(join(workspaceCwd, 'README.md'), '# smoke test workspace\n', 'utf8');

  try {
    await runHappyPathCheck(workspaceCwd);
    await runCancelCheck(workspaceCwd);
  } finally {
    // The `opencode` subprocess can hold the workspace dir open briefly
    // after `kill()` resolves on Windows; retry the cleanup a few times
    // instead of failing the whole smoke run over a transient EBUSY.
    await rmWithRetry(workspaceCwd);
  }

  console.log('\n=== Summary ===');
  for (const check of checks) {
    console.log(`${check.passed ? '✅' : '❌'} ${check.name}`);
  }

  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll smoke checks passed.');
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
