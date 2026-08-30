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

# 5. (optional) End-to-end verification against a real MySQL
pnpm e2e:mvp           # scripts/mvp-e2e-check.ts — see docs/research/mvp-e2e-verification.md
```

`pnpm e2e:mvp` boots the real `AppModule` in-process on an ephemeral port and
drives it over HTTP the way the Web console and a Runner do (dispatch → claim →
events → cancel → evidence gating → retry → audit trail). It needs no OpenCode
binary and no GitHub App, creates only timestamp-namespaced projects, and deletes
them at the end. Set `AGENTDOCK_URL` to point it at an already-running server.

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
| `POST /projects`                          | Create a project (name, workspaceKey, defaultBranch, testCommand, buildCommand, evidenceRules) |
| `GET /projects` · `GET /projects/:id`     | List / read projects                                 |
| `PATCH /projects/:id`                     | Update; `null` clears a command or the evidence-rule override |
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
| `GET /runs/:runId/approvals`              | List approvals requested for a run                   |
| `GET /approvals/pending`                  | List every approval still awaiting a decision         |
| `GET /approvals/:id`                      | Approval detail                                       |
| `POST /approvals/:id/resolve`             | Approve/deny a pending approval (`{ decision }`)       |
| `GET /audit-logs`                         | Audit trail; filter by `action`/`source`/`taskId`/`runId`/`projectId`, paginate with `limit`/`offset` |
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
POST /runner/runs/:id/heartbeat  -> { cancelRequested, approvals[] } (cancellation + approval down-channel)
POST /runner/runs/:id/approvals  -> requests approval for a shell/push/destructive action (#37)
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
- Approval gate (docs/tasks.md T8.3, #37): a runner blocked on a high-risk
  action (an ACP `session/request_permission` shell/tool-call request, a
  `push`, or anything it flags as `destructive`) calls
  `POST /runner/runs/:id/approvals`, which creates a pending `Approval` row
  and transitions the run to `needs_approval`. The runner then polls
  `POST /runner/runs/:id/heartbeat` — the same channel used for cancellation —
  whose response now also carries `approvals: [{ approvalId, action, status }]`
  (a run can have more than one approval outstanding at once — e.g.
  concurrent ACP shell/tool-call permission requests — and the list also
  includes approvals resolved in roughly the last hour, so a poller waiting
  on a specific `approvalId` can observe the transition out of `pending`)
  once a decision (`POST /approvals/:id/resolve` from the Web console) is
  made. Every request/resolution is also appended to `run_events` as a
  `type: 'approval'` event, so it shows up over the existing SSE stream
  without a separate channel. The run status machine (`@agentdock/protocol`)
  allows `publishing <-> needs_approval` in addition to the existing
  `running <-> needs_approval`, so a push awaiting approval doesn't have to
  jump back to `running` first.
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
- Pull Request creation (docs/tasks.md T6.5 / #30): when a runner reports
  `complete({ status: 'failed', errorCode: 'evidence_incomplete' })` for a run
  that already pushed a commit (a `commit` artifact with `metadata.pushed:
  true`), `RunsService.complete` tries to open a PR through
  `PullRequestService`/`GitHubAppService` (`base` = the project's
  `defaultBranch`, `head` = the pushed branch) *before* recording the terminal
  status. On success a `pull_request` artifact (title/url/PR number) is
  appended and `@agentdock/governance`'s `decideCompletion` is re-evaluated,
  so a `fix`/`implement` run that only needed the PR to satisfy evidence flips
  to `succeeded`. Which bound repository to target is resolved by
  `resolveTargetRepository` (docs/tasks.md T6.5 follow-up / #51): GitHub-
  sourced tasks carry the originating `callbackRepo` (`owner/repo`), so a
  project with multiple bound repositories is supported as long as
  `callbackRepo` names one of them; tasks with no `callbackRepo` (typically
  `source: 'web'`) still require the project to have exactly one bound
  repository, since there is nothing to disambiguate with. When no
  repository can be resolved, or the App isn't configured, PR creation is
  skipped (not an error) and the run stays `failed`. Re-completing against a
  branch that already has an open PR reuses that PR instead of erroring
  (idempotent retries).
- GitHub status callback comments (docs/tasks.md T6.6 / #31): at each key run
  lifecycle point — picked up (`RunnerGatewayService.claim`), running, failed
  (`RunsService.applyStatus`), PR created, completed (`RunsService.complete`)
  — `RunCallbackService` posts a comment back on the Issue/PR thread that
  triggered the task. The callback target (`owner/repo` + issue/PR number) is
  captured at webhook-ingest time from `@agentdock/github-adapter`'s
  normalized event and stored on the `Task` row (`callbackRepo` /
  `callbackIssueNumber` / `callbackIsPullRequest`); `source: 'web'` tasks have
  none of these set and are silently skipped. Like PR creation, the target
  repository is resolved by `resolveTargetRepository` (#51) using that same
  `callbackRepo`, so multi-repository projects are supported here too; every
  call is best-effort and a failed comment post is logged as a warning and
  never blocks or fails the run itself.

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
   trigger mention, dedupe `sourceRef`, and the status-callback target
   (`callbackRepo` / `callbackIssueNumber` / `callbackIsPullRequest`, #31 —
   the issue/PR number the triggering comment or event belongs to, not the
   comment's own id); the actor must pass `GITHUB_ACTOR_ALLOWLIST` when
   configured (requirements.md §6.2). A `null` result (no mention, bot
   self-callback, disallowed actor) is ignored.
6. Otherwise `TasksService.create` queues the task (carrying the callback
   target through onto the `Task` row), reusing its own
   `sourceRef`/`deliveryId` unique-constraint dedupe as a second line of
   defense against a race between two concurrent deliveries.

`NestFactory.create(AppModule, { rawBody: true })` keeps `request.rawBody`
(the exact bytes GitHub sent) available next to the parsed JSON body — the
signature would not match a body that was parsed and re-serialized.
