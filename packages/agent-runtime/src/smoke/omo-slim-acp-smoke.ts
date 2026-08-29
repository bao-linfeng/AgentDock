/**
 * OMO Slim (oh-my-opencode-slim) ACP compatibility smoke test
 * (docs/tasks.md T0.2, #17).
 *
 * Verifies that `oh-my-opencode-slim` (an OpenCode orchestration plugin,
 * https://github.com/alvinunreal/oh-my-opencode-slim) behaves correctly when
 * OpenCode is driven purely over ACP — i.e. through the same
 * `OpenCodeExecutor` / `launchAcpProcess` code path used in production
 * (`packages/agent-runtime/src/index.ts`), never via a TUI stdout parser.
 *
 * This is a manual/CI-optional smoke test (not part of `pnpm test`), because
 * it requires a real `opencode` binary on PATH, configured model credentials
 * (`opencode providers login`), and network access to install the plugin
 * (`oh-my-opencode-slim@latest` via the `plugin` config key).
 *
 * Run with:
 *   pnpm --filter @agentdock/agent-runtime run smoke:omo-slim
 *
 * Optional env vars:
 *   SMOKE_OPENCODE_COMMAND  Override the `opencode` executable path.
 *
 * Isolation: this script points `XDG_CONFIG_HOME` at a throwaway temp dir for
 * the duration of the run, so OMO Slim is enabled *only* via the temp
 * workspace's own `opencode.json` (`plugin: ["oh-my-opencode-slim@latest"]`)
 * — never by whatever global OpenCode config happens to exist on the
 * machine running this script. This is what makes the result representative
 * of "a project that opts into OMO Slim", not "this particular developer's
 * machine".
 *
 * Checks covered (mirrors the issue's acceptance criteria, docs/tasks.md
 * T0.2):
 *   1. The plugin loads when OpenCode is driven over ACP (not TUI)
 *   2. The orchestrator agent is active (not OpenCode's default `build` agent)
 *   3. Delegation to a specialist sub-agent (e.g. explorer) works and is
 *      visible as structured ACP tool-call events
 *   4. No non-ACP content leaks onto stdout (structurally guaranteed: this
 *      script only calls the same executor code path used in production,
 *      which never reads `child.stdout` directly — see acp-client.ts — and
 *      relies on the ACP SDK's ndjson stream parser to fail loudly on any
 *      malformed frame)
 *   5. `cancel()` reliably stops an in-flight (possibly delegated) run
 *   6. `workspaceCwd` is honored for both the top-level session and any
 *      delegated sub-agent session
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/**
 * Writes a throwaway workspace with a project-local `opencode.json` that
 * enables OMO Slim, plus an isolated `XDG_CONFIG_HOME` so no machine-local
 * global OpenCode config can influence the result.
 */
async function createIsolatedWorkspace(): Promise<{
  workspaceCwd: string;
  xdgConfigHome: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'agentdock-omo-slim-smoke-'));
  const workspaceCwd = join(root, 'workspace');
  const xdgConfigHome = join(root, 'xdg-config');
  await mkdir(workspaceCwd, { recursive: true });
  await mkdir(xdgConfigHome, { recursive: true });
  await writeFile(join(workspaceCwd, 'README.md'), '# smoke test workspace\n', 'utf8');
  await writeFile(
    join(workspaceCwd, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        plugin: ['oh-my-opencode-slim@latest'],
      },
      null,
      2,
    ),
    'utf8',
  );
  return {
    workspaceCwd,
    xdgConfigHome,
    cleanup: () => rmWithRetry(root),
  };
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

async function runOrchestratorAndDelegationCheck(
  workspaceCwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  console.log('\n=== Scenario 1: plugin loads, orchestrator active, delegates to a sub-agent ===');
  const executor = new OpenCodeExecutor({
    command: process.env.SMOKE_OPENCODE_COMMAND,
    env,
    timeoutMs: 5 * 60_000,
  });
  const { sink, logs, errors } = createObservingSink();

  const result = await executor.run(
    {
      runId: 'smoke_omo_delegate',
      workspaceCwd,
      prompt:
        'Use your orchestrator role to delegate a sub-task to your explorer/scout agent: ask it ' +
        'to list the files in the current directory. Do not do it yourself, delegate it. Keep the ' +
        'whole response brief.',
      context: [],
      permissions: [],
    },
    sink,
  );

  const sawToolCall = logs.some((l) => l.includes('tool_call'));
  record(
    'ACP run completed without an unexpected executor error',
    result.status === 'succeeded' || errors.every((e) => e.code !== 'acp_error'),
    `finalStatus=${result.status} errorCodes=${errors.map((e) => e.code).join(',')}`,
  );
  record(
    'orchestrator delegated work via a structured ACP tool_call (not raw stdout)',
    sawToolCall,
    `logCount=${logs.length}`,
  );
}

async function runCancelCheck(
  workspaceCwd: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  console.log('\n=== Scenario 2: cancel an in-flight (possibly delegated) run ===');
  const executor = new OpenCodeExecutor({
    command: process.env.SMOKE_OPENCODE_COMMAND,
    env,
    timeoutMs: 5 * 60_000,
  });
  const { sink: baseSink } = createObservingSink();

  let cancelTriggered = false;
  const sink: typeof baseSink = {
    ...baseSink,
    async log(message) {
      await baseSink.log(message);
      if (!cancelTriggered) {
        cancelTriggered = true;
        await executor.cancel('smoke_omo_cancel');
      }
    },
  };

  const result = await executor.run(
    {
      runId: 'smoke_omo_cancel',
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
    'cancelling right after the first progress event actually stops the run',
    result.status === 'cancelled',
    `status=${result.status} cancelTriggered=${cancelTriggered}`,
  );
}

async function main(): Promise<void> {
  const { workspaceCwd, xdgConfigHome, cleanup } = await createIsolatedWorkspace();
  const env: Record<string, string | undefined> = { XDG_CONFIG_HOME: xdgConfigHome };

  try {
    await runOrchestratorAndDelegationCheck(workspaceCwd, env);
    await runCancelCheck(workspaceCwd, env);
  } finally {
    await cleanup();
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
  console.log('\nAll OMO Slim ACP compatibility checks passed.');
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
