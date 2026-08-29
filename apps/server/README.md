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
| `GET /runners` · `GET /runners/:id`       | Runner inventory (`online` derived from heartbeat)   |
| `POST /runners/:id/revoke`                | Revoke a runner token                                |
| `GET /runners/:id/projects`               | Project → local workspace path mappings              |
| `PUT /runners/:id/projects/:projectId`    | Map a project onto a runner-local `workspacePath`    |
| `DELETE /runners/:id/projects/:projectId` | Remove a mapping                                     |
| `GET /events/runs/:id?afterSeq=`          | SSE stream: replay from DB, then live events         |
| `GET /github/status`                      | Whether the GitHub integration is configured         |

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
