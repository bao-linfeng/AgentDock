import { resolve } from 'node:path';
import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '@agentdock/shared';
import { type RunnerConfig, checkFilePermissions, loadConfig, validateProjects } from './config.js';

/**
 * Local Runner entry point — SKELETON.
 *
 * Confirmed decisions: single runner, one task at a time, pure OpenCode ACP.
 *
 * TODO(M3/T3.2): register + heartbeat against `${serverUrl}/runner/...`.
 * TODO(M3/T3.4): actively claim tasks (GET /runner/tasks/claim).
 * TODO(cancel): the polling model has no downstream cancel channel yet — carry a
 *   `cancelRequested` flag on the heartbeat response (docs/architecture.md §9
 *   review note) before implementing OpenCode cancellation.
 * TODO(M4): drive OpenCodeExecutor; TODO(M5): WorktreeManager lifecycle.
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

  console.log(
    `[runner] heartbeat interval: ${DEFAULT_HEARTBEAT_INTERVAL_MS}ms (loop not implemented yet)`,
  );
  console.log('[runner] skeleton only — register/claim/execute loop is TODO (M3/M4).');
}

void main();
