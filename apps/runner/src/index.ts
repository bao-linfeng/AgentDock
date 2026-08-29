import { resolve } from 'node:path';
import { OpenCodeExecutor } from '@agentdock/agent-runtime';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '@agentdock/shared';
import { ClaimExecuteLoop } from './claim-execute-loop.js';
import { type RunnerConfig, checkFilePermissions, loadConfig, validateProjects } from './config.js';
import { HeartbeatLoop } from './heartbeat-loop.js';
import { RunnerApiError, RunnerClient, RunnerTokenRevokedError } from './runner-client.js';

/** Poll interval for `GET /runner/tasks/claim` while idle, in ms. */
const CLAIM_POLL_INTERVAL_MS = 5_000;

/**
 * Local Runner entry point.
 *
 * Confirmed decisions: single runner, one task at a time, pure OpenCode ACP.
 *
 * T3.2 (#23): register once, then heartbeat on `DEFAULT_HEARTBEAT_INTERVAL_MS`,
 * reporting online/offline transitions.
 *
 * T3.4b (#24): poll `GET /runner/tasks/claim` and drive the claim -> git
 * worktree -> OpenCodeExecutor -> verify -> commit -> complete loop, honoring
 * cancellation via the per-run heartbeat (see `ClaimExecuteLoop`).
 */
async function main(): Promise<void> {
  const configPath = resolve(process.argv[2] ?? 'runner.config.json');

  let config: RunnerConfig;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    console.error(`[runner] failed to load config at ${configPath}`);
    console.error(String(error));
    console.error('Copy runner.config.example.json to runner.config.json and edit it.');
    process.exitCode = 1;
    return;
  }

  console.log(`[runner] "${config.runnerName}" -> server ${config.serverUrl}`);
  console.log(`[runner] mapped projects: ${Object.keys(config.projects).length}`);

  // Surface config safety issues before attempting any work.
  const issues = [...(await checkFilePermissions(configPath)), ...(await validateProjects(config))];
  for (const issue of issues) {
    const tag = issue.level === 'error' ? 'ERROR' : 'warn';
    console.error(`[runner] ${tag} [${issue.projectId}] ${issue.message}`);
  }
  if (issues.some((i) => i.level === 'error')) {
    console.error('[runner] config validation failed; fix the errors above before starting.');
    process.exitCode = 1;
    return;
  }

  const client = new RunnerClient({ serverUrl: config.serverUrl, runnerToken: config.runnerToken });
  const loop = new HeartbeatLoop({
    client,
    intervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    runnerName: config.runnerName,
    version: process.env.npm_package_version,
    onStateChange: (state) => {
      console.log(`[runner] connection state -> ${state}`);
    },
    onError: (error) => {
      const message = error instanceof RunnerApiError ? error.message : String(error);
      console.error(`[runner] heartbeat failed: ${message}`);
    },
    onRevoked: (error) => {
      console.error(`[runner] ${error.message}`);
      console.error('[runner] token revoked by the server; stopping. Update runner.config.json.');
      process.exitCode = 1;
    },
  });

  try {
    await loop.start();
  } catch (error) {
    if (error instanceof RunnerTokenRevokedError) {
      console.error(`[runner] registration rejected: ${error.message}`);
    } else {
      console.error(
        `[runner] failed to register with ${config.serverUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[runner] registered; heartbeat every ${DEFAULT_HEARTBEAT_INTERVAL_MS}ms.`);

  const executor = new OpenCodeExecutor();
  const claimLoop = new ClaimExecuteLoop({
    client,
    pollIntervalMs: CLAIM_POLL_INTERVAL_MS,
    executor,
    onLog: (message) => {
      console.log(`[runner] ${message}`);
    },
    onError: (error) => {
      console.error(
        `[runner] claim/execute error: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  });
  claimLoop.start();
  console.log(`[runner] claim/execute loop polling every ${CLAIM_POLL_INTERVAL_MS}ms.`);

  const shutdown = () => {
    console.log('[runner] shutting down…');
    claimLoop.stop();
    loop.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
