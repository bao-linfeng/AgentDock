# @agentdock/server — Control Server

NestJS control plane (docs/architecture.md §2 / §7 / §9). It owns projects,
tasks, runs, run events and the Runner Gateway. It never touches your local
files and never launches OpenCode — that is the Local Runner's job.

## Local development

```bash
# 1. MySQL 8 (host port configurable via MYSQL_PORT)
pnpm db:up

# 2. Configuration
cd apps/server
cp env.example .env    # then set DATABASE_URL / API_AUTH_TOKEN / RUNNER_TOKEN

# 3. Schema + client
pnpm prisma:migrate    # prisma migrate dev (prisma:deploy for existing DBs)

# 4. Run
pnpm dev               # tsx watch, or: pnpm build && pnpm start
```

Startup fails fast when a token is a placeholder, shorter than 16 characters, or
when `API_AUTH_TOKEN` equals `RUNNER_TOKEN` (a runner token must be revocable on
its own — docs/requirements.md §10).

## Authentication

| Audience     | Token             | How to send it                                                        |
| ------------ | ----------------- | --------------------------------------------------------------------- |
| Web console  | `API_AUTH_TOKEN`  | `Authorization: Bearer …`, `x-agentdock-token`, or `?access_token=`    |
| Local Runner | `RUNNER_TOKEN`    | `Authorization: Bearer …`                                             |

`GET /health` is the only unauthenticated route. `?access_token=` exists because
the browser `EventSource` API cannot send headers; prefer headers elsewhere.

## Web API

| Method / path                             | Purpose                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| `GET /health`                             | Liveness probe (public)                              |
| `POST /projects`                          | Create a project (name, workspaceKey, defaultBranch, testCommand, buildCommand) |
| `GET /projects` · `GET /projects/:id`     | List / read projects                                 |
| `PATCH /projects/:id`                     | Update; `null` clears a command                      |
| `DELETE /projects/:id`                    | Delete — refused (409) while runs are in flight      |
| `POST /tasks`                             | Create a task and queue its first run                |
| `GET /tasks?projectId=&status=&source=`   | Filtered task list                                   |
| `GET /tasks/:id` · `GET /tasks/:id/runs`  | Task detail / its runs                               |
| `POST /tasks/:id/cancel`                  | Cancel the latest non-terminal run                   |
| `GET /runs/:id`                           | Run detail (includes `cancelRequested`)              |
| `GET /runs/:id/events?afterSeq=&limit=`   | Ordered run timeline                                 |
| `GET /runs/:id/artifacts`                 | Artifact metadata (diff / commit / PR …)             |
| `POST /runs/:id/cancel`                   | Request cancellation                                 |
| `POST /runs/:id/retry`                    | Retry a `failed` run as a new run (history kept)     |
| `GET /runners` · `GET /runners/:id`       | Runner inventory (`online` derived from heartbeat)   |
| `POST /runners/:id/revoke`                | Revoke a runner token                                |
| `GET /runners/:id/projects`               | Project → local workspace path mappings              |
| `PUT /runners/:id/projects/:projectId`    | Map a project onto a runner-local `workspacePath`    |
| `DELETE /runners/:id/projects/:projectId` | Remove a mapping                                     |
| `GET /events/runs/:id?afterSeq=`          | SSE stream: replay from DB, then live events         |
| `GET /github/status`                      | Whether the GitHub integration is configured         |
| `POST /github/webhook`                    | GitHub webhook receiver (public; HMAC-verified — see below) |

## Runner Gateway

```text
POST /runner/register            -> registers/refreshes the runner (token hash only)
GET  /runner/tasks/claim         -> { claimed, work? }
POST /runner/runs/:id/events     -> { seq }            (status events drive the state machine)
POST /runner/runs/:id/heartbeat  -> { cancelRequested } (cancellation down-channel)
POST /runner/runs/:id/complete   -> terminal status + artifacts
POST /runner/heartbeat           -> idle heartbeat, lists in-flight runs
```

Notes:

- A runner may only claim work for projects explicitly mapped to it and enabled
  ("Runner 不执行未知 Project" — docs/architecture.md §14).
- Claiming is a single conditional `UPDATE … WHERE status='queued' AND runner_id
  IS NULL`, so two concurrent claims can never take the same run. MVP runs one
  task per runner at a time.
- Run status transitions are validated against `@agentdock/protocol`
  (architecture §8): completing as `succeeded` requires `verifying` →
  `publishing` first. `failed` / `cancelled` are allowed from any live state.
- Cancellation never introduces a `cancelling` status: the API stamps
  `task_runs.cancel_requested_at` and the runner picks it up from its heartbeat.
- Event payloads pass through `redactSecrets` before they are persisted
  ("Secret 不写 RunEvent" — architecture §14).
- A background sweep (`RunnerDisconnectSweeper`, `@nestjs/schedule`) runs every
  `RUNNER_DISCONNECT_SWEEP_INTERVAL_MS` (15s): once a runner's heartbeat is
  older than `RUNNER_OFFLINE_TIMEOUT_MS` (45s) it is marked `offline` and any
  run it still owns is failed with `errorCode: 'runner_disconnected'` instead
  of being left stuck in-flight forever (docs/tasks.md T9.1 / #38).
- `POST /runs/:id/retry` only accepts a `failed` run and only when the task has
  no other active run; it creates a new `TaskRun` row (new id, `queued`) and
  leaves the failed run's events untouched so history is preserved
  (docs/tasks.md T9.2 / #39).
- Idempotency (docs/tasks.md T9.3 / #40): GitHub delivery ids and normalized
  `sourceRef`s are unique columns, so a replayed `POST /tasks` returns the
  existing task (`deduplicated: true`) instead of creating a duplicate; claim
  is a single conditional `UPDATE`, and completing an already-terminal run
  returns 409 instead of double-applying artifacts/events.

## GitHub Webhook (`POST /github/webhook`)

Implements T6.2 (#29). This route is intentionally **not** behind
`ApiTokenGuard` — GitHub cannot send our API token — so authenticity comes
from verifying the `X-Hub-Signature-256` header instead:

1. Reject (401) if `GITHUB_WEBHOOK_SECRET` is not configured, or if the
   HMAC-SHA256 signature over the exact raw request body does not match
   (constant-time compare via `node:crypto`'s `timingSafeEqual`).
2. Dedupe by `X-GitHub-Delivery` (`tasks.deliveryId`, unique): a delivery GitHub
   retries (timeout / non-2xx) short-circuits to `{ status: 'deduplicated' }`
   before the payload is even parsed.
3. Unsupported events (e.g. `ping`) return `{ status: 'ignored' }` with a 200 —
   the signature already proves the sender is GitHub, so we accept rather than
   make GitHub retry an event we don't model.
4. The event's `repository.full_name` must resolve to a `Repository` row bound
   to a `Project` (`repositories` table, `#28`); otherwise the delivery is
   ignored.
5. `@agentdock/github-adapter`'s `normalizeGitHubEvent` extracts the actor,
   trigger mention, and dedupe `sourceRef`; the actor must pass
   `GITHUB_ACTOR_ALLOWLIST` when configured (requirements.md §6.2). A `null`
   result (no mention, bot self-callback, disallowed actor) is ignored.
6. Otherwise `TasksService.create` queues the task, reusing its own
   `sourceRef`/`deliveryId` unique-constraint dedupe as a second line of
   defense against a race between two concurrent deliveries.

`NestFactory.create(AppModule, { rawBody: true })` keeps `request.rawBody`
(the exact bytes GitHub sent) available next to the parsed JSON body — the
signature would not match a body that was parsed and re-serialized.
