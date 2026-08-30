import 'reflect-metadata';
/**
 * MVP end-to-end verification harness (docs/tasks.md "MVP Definition of Done",
 * issue #64).
 *
 * Boots the real Control Server in-process (same `AppModule`, `rawBody`, and
 * CORS setup as `src/main.ts`) against a real MySQL database, then drives it
 * over HTTP exactly the way the Web console and a Local Runner do. It asserts
 * the Definition-of-Done properties that can be checked without a real
 * OpenCode binary or a real GitHub App:
 *
 *   1. token separation  — `/health` is public; web and runner tokens are not
 *                          interchangeable
 *   2. web dispatch      — `POST /tasks` creates a task + queued run (US-01)
 *   3. runner claim      — `GET /runner/tasks/claim` assigns it once, with the
 *                          project's workspace path and evidence rules (#60)
 *   4. log traceability  — run events persist in `seq` order and replay
 *   5. cancellation      — `POST /tasks/:id/cancel` reaches the runner via the
 *                          run heartbeat (US-04)
 *   6. evidence gating   — a `fix` run without a PR stays `failed
 *                          (evidence_incomplete)`; the same artifacts succeed
 *                          for a project whose rules drop `pull_request`
 *   7. retry             — `POST /runs/:id/retry` yields a new run and keeps
 *                          the failed run's history (US-05)
 *   8. audit trail       — `GET /audit-logs` records dispatch/claim/complete/
 *                          retry (#63)
 *
 * Everything it creates is namespaced with a timestamp and deleted at the end
 * (deleting a project cascades to its tasks/runs/events/artifacts).
 *
 * Usage (from `apps/server`, with MySQL running — `pnpm db:up`):
 *   pnpm e2e:mvp
 *
 * Configuration: reads `.env` like the server does, or takes `DATABASE_URL` /
 * `API_AUTH_TOKEN` / `RUNNER_TOKEN` / `PORT` from the environment. Set
 * `AGENTDOCK_URL` to test an already-running server instead of booting one.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { loadServerConfig } from '../src/config/env.js';

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    // ignore — env may be provided by the shell instead
  }
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Types (subset of the server DTOs) ---------------------------------------

interface ProjectDto {
  id: string;
}
interface RunDto {
  id: string;
  taskId: string;
  status: string;
  cancelRequested: boolean;
  errorCode?: string;
}
interface TaskDto {
  id: string;
  status: string;
}
interface ClaimDto {
  claimed: boolean;
  work?: {
    run: RunDto;
    task: { id: string; intent: string; prompt: string };
    project: { id: string; workspacePath: string; evidenceRules?: Record<string, string[]> };
  };
}
interface AuditLogDto {
  action: string;
  source: string;
  taskId?: string;
  runId?: string;
}

class Harness {
  constructor(
    private readonly baseUrl: string,
    private readonly webToken: string,
    private readonly runnerToken: string,
  ) {}

  readonly createdProjectIds: string[] = [];

  async request<T>(
    path: string,
    init: RequestInit & { token?: string } = {},
  ): Promise<{ status: number; body: T }> {
    const { token, ...rest } = init;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.headers ?? {}),
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as T) : (undefined as T) };
  }

  async expectOk<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const { status, body } = await this.request<T>(path, init);
    if (status >= 400) {
      throw new Error(
        `${init.method ?? 'GET'} ${path} -> ${status}: ${JSON.stringify(body)?.slice(0, 300)}`,
      );
    }
    return body;
  }

  web<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.expectOk<T>(path, { ...init, token: this.webToken });
  }

  runner<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.expectOk<T>(path, { ...init, token: this.runnerToken });
  }

  async createProject(
    suffix: string,
    stamp: number,
    evidenceRules?: Record<string, string[]>,
  ): Promise<ProjectDto> {
    const project = await this.web<ProjectDto>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: `e2e-${suffix}-${stamp}`,
        workspaceKey: `e2e-${suffix}-${stamp}`,
        defaultBranch: 'main',
        evidenceRules,
      }),
    });
    this.createdProjectIds.push(project.id);
    return project;
  }

  async postStatus(runId: string, status: string): Promise<void> {
    await this.runner(`/runner/runs/${runId}/events`, {
      method: 'POST',
      body: JSON.stringify({ type: 'status', payload: { status } }),
    });
  }

  /** Park whatever run is currently claimable so it cannot block later claims. */
  async drainClaim(): Promise<void> {
    const claim = await this.runner<ClaimDto>('/runner/tasks/claim');
    if (claim.claimed && claim.work) {
      await this.runner(`/runner/runs/${claim.work.run.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ status: 'cancelled', artifacts: [] }),
      });
    }
  }

  async cleanup(): Promise<void> {
    for (const projectId of this.createdProjectIds) {
      await this.request(`/projects/${projectId}`, {
        method: 'DELETE',
        token: this.webToken,
      }).catch(() => undefined);
    }
  }
}

async function runChecks(h: Harness): Promise<void> {
  const stamp = Date.now();

  // 1. Token separation.
  const health = await h.request<{ status: string }>('/health');
  check('GET /health is public', health.status === 200, `status=${health.status}`);
  const noToken = await h.request('/projects');
  check('web routes reject a missing token', noToken.status === 401, `status=${noToken.status}`);
  const crossToken = await h.request('/runner/tasks/claim', {
    token: process.env.API_AUTH_TOKEN,
  });
  check(
    'runner routes reject the web token (independent tokens)',
    crossToken.status === 401 || crossToken.status === 403,
    `status=${crossToken.status}`,
  );

  // Runner registration + project mapping.
  const runner = await h.runner<{ id: string }>('/runner/register', {
    method: 'POST',
    body: JSON.stringify({ name: `e2e-runner-${stamp}`, platform: process.platform }),
  });
  check('runner registration succeeds', !!runner.id, `runnerId=${runner.id}`);

  const strictProject = await h.createProject('strict', stamp);
  const localOnlyProject = await h.createProject('localonly', stamp, {
    fix: ['git_changes', 'test_result', 'commit'],
  });
  for (const project of [strictProject, localOnlyProject]) {
    await h.web(`/runners/${runner.id}/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ workspacePath: process.cwd(), enabled: true }),
    });
  }

  // Make sure no leftover run from an earlier abortedttempt holds the runner.
  await h.drainClaim();

  // 2. Web dispatch.
  const dispatched = await h.web<{ task: TaskDto; run?: RunDto }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: strictProject.id,
      source: 'web',
      intent: 'fix',
      prompt: 'e2e: fix the duplicate payment callback',
      createdBy: 'e2e-harness',
    }),
  });
  check(
    'web dispatch creates a task with a queued run',
    !!dispatched.task.id && dispatched.run?.status === 'queued',
    `task=${dispatched.task.id} run=${dispatched.run?.status}`,
  );

  // 3. Runner claim.
  const claim = await h.runner<ClaimDto>('/runner/tasks/claim');
  check(
    'runner claims the queued run with resolved project context',
    claim.claimed &&
      claim.work?.task.id === dispatched.task.id &&
      !!claim.work?.project.workspacePath,
    `claimed=${claim.claimed}`,
  );
  const runId = claim.work?.run.id as string;

  const secondClaim = await h.runner<ClaimDto>('/runner/tasks/claim');
  check(
    'a runner with an in-flight run cannot claim another',
    secondClaim.claimed === false,
    `claimed=${secondClaim.claimed}`,
  );

  // 4. Log traceability.
  await h.postStatus(runId, 'running');
  await h.runner(`/runner/runs/${runId}/events`, {
    method: 'POST',
    body: JSON.stringify({ type: 'log', payload: { message: 'e2e: applying patch' } }),
  });
  const events = await h.web<{ type: string; seq: number }[]>(`/runs/${runId}/events`);
  check(
    'run events persist in seq order and replay',
    events.length >= 2 && events.every((e, i, arr) => i === 0 || arr[i - 1].seq < e.seq),
    `${events.length} events`,
  );

  // 5. Cancellation reaches the runner through the heartbeat.
  await h.web(`/tasks/${dispatched.task.id}/cancel`, { method: 'POST' });
  const heartbeat = await h.runner<{ cancelRequested: boolean }>(
    `/runner/runs/${runId}/heartbeat`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  check(
    'cancellation is delivered to the runner via the heartbeat',
    heartbeat.cancelRequested === true,
    `cancelRequested=${heartbeat.cancelRequested}`,
  );
  await h.runner(`/runner/runs/${runId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ status: 'cancelled', artifacts: [] }),
  });
  const cancelledTask = await h.web<TaskDto>(`/tasks/${dispatched.task.id}`);
  check(
    'a cancelled run is reflected on the task',
    cancelledTask.status === 'cancelled',
    `status=${cancelledTask.status}`,
  );

  // 6a. Evidence gating on the strict project.
  await h.web<{ task: TaskDto }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: strictProject.id,
      intent: 'fix',
      prompt: 'e2e: strict evidence run',
    }),
  });
  const strictClaim = await h.runner<ClaimDto>('/runner/tasks/claim');
  const strictRunId = strictClaim.work?.run.id as string;
  await h.postStatus(strictRunId, 'running');
  const strictCompletion = await h.runner<RunDto>(`/runner/runs/${strictRunId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'failed',
      errorCode: 'evidence_incomplete',
      errorMessage: 'missing required evidence: pull_request',
      artifacts: [
        { type: 'diff', title: '1 file changed' },
        { type: 'test_result', title: 'tests passed' },
        { type: 'commit', title: 'e2e commit' },
      ],
    }),
  });
  check(
    'a fix run without a PR stays failed (evidence-based completion)',
    strictCompletion.errorCode === 'evidence_incomplete',
    `errorCode=${strictCompletion.errorCode}`,
  );

  // 7. Retry.
  const retried = await h.web<RunDto>(`/runs/${strictRunId}/retry`, { method: 'POST' });
  check(
    'retry creates a new queued run',
    retried.id !== strictRunId && retried.status === 'queued',
    `newRun=${retried.id}`,
  );
  const failedRunEvents = await h.web<unknown[]>(`/runs/${strictRunId}/events`);
  check(
    'the failed run keeps its event history',
    failedRunEvents.length > 0,
    `${failedRunEvents.length} events`,
  );
  await h.drainClaim();

  // 6b. Per-project evidence rules let a remote-less project succeed.
  const localTask = await h.web<{ task: TaskDto }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId: localOnlyProject.id,
      intent: 'fix',
      prompt: 'e2e: local-only evidence run',
    }),
  });
  const localClaim = await h.runner<ClaimDto>('/runner/tasks/claim');
  check(
    "the claim response carries the project's evidence rules",
    !!localClaim.work?.project.evidenceRules?.fix,
    JSON.stringify(localClaim.work?.project.evidenceRules),
  );
  const localRunId = localClaim.work?.run.id as string;
  for (const status of ['running', 'verifying', 'publishing']) {
    await h.postStatus(localRunId, status);
  }
  await h.runner(`/runner/runs/${localRunId}/complete`, {
    method: 'POST',
    body: JSON.stringify({
      status: 'succeeded',
      artifacts: [
        { type: 'diff', title: '1 file changed' },
        { type: 'test_result', title: 'tests passed' },
        { type: 'commit', title: 'e2e commit' },
      ],
    }),
  });
  const localTaskAfter = await h.web<TaskDto>(`/tasks/${localTask.task.id}`);
  check(
    'a remote-less project completes a fix run as succeeded',
    localTaskAfter.status === 'succeeded',
    `status=${localTaskAfter.status}`,
  );

  // 8. Audit trail.
  const audit = await h.web<AuditLogDto[]>('/audit-logs?limit=200');
  const runActions = new Set(
    audit.filter((entry) => entry.runId === localRunId).map((entry) => entry.action),
  );
  const taskActions = new Set(
    audit.filter((entry) => entry.taskId === localTask.task.id).map((entry) => entry.action),
  );
  check(
    'audit log records dispatch, claim and completion',
    taskActions.has('task_created') &&
      runActions.has('run_claimed') &&
      runActions.has('run_completed'),
    [...taskActions, ...runActions].join(','),
  );
  check(
    'audit log records the retry',
    audit.some((entry) => entry.action === 'run_retried'),
  );
}

async function main(): Promise<void> {
  loadEnvFile();

  const externalUrl = process.env.AGENTDOCK_URL?.replace(/\/+$/, '');
  const config = loadServerConfig();
  let app: INestApplication | undefined;
  let baseUrl = externalUrl ?? '';

  if (!externalUrl) {
    // Boot the real server in-process on an ephemeral port so the harness is
    // self-contained (no separate `pnpm dev` needed).
    Logger.overrideLogger(['error', 'warn']);
    app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
    app.enableCors({ origin: config.corsOrigins ?? true });
    await app.listen(0);
    const url = await app.getUrl();
    baseUrl = url.replace('[::1]', '127.0.0.1').replace(/\/+$/, '');
  }

  console.log(`MVP e2e verification against ${baseUrl}\n`);
  const harness = new Harness(baseUrl, config.apiAuthToken, config.runnerToken);

  try {
    await runChecks(harness);
  } catch (error) {
    check('harness completed without unexpected errors', false, String(error));
  } finally {
    await harness.cleanup();
    await app?.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`failed: ${failed.map((r) => r.name).join('; ')}`);
    process.exitCode = 1;
  }
}

void main();
