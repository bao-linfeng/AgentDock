# AgentDock

<p align="center">
  <strong>Local-first control plane for coding agents.</strong><br>
  A local-first control plane and remote dispatch system for local coding agents.
</p>

<p align="center">
  <a href="./README.md">English</a> •
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-project-structure">Structure</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

> [!NOTE]
> **Project Status: early development — Control Server up, Runner claim→execute loop wired, Pull Request creation now automated.**
>
> The monorepo scaffolding is in place and several foundation packages are
> implemented and unit-tested: protocol schemas & run-status state machine,
> Git worktree runtime, GitHub event normalizer, task-queue engine, evidence
> governance, and runner config/secret-redaction. The **NestJS Control Server
> now runs** (projects, tasks, runs, run events, Runner Gateway with a
> cancellation channel — see [`apps/server/README.md`](./apps/server/README.md)).
> The **OpenCode ACP executor is implemented and unit-tested**
> (`packages/agent-runtime`, via `@agentclientprotocol/sdk`), and the **Local
> Runner now drives the full claim → worktree → execute → verify → commit →
> push → complete loop** end to end (`apps/runner/src/claim-execute-loop.ts`),
> honoring cancellation via the per-run heartbeat. Pushing the agent branch to
> a configured remote is implemented (`WorktreeManager.push()`,
> [#27](https://github.com/bao-linfeng/AgentDock/issues/27)) and reuses
> whatever git remote/credentials are already set up in the project's
> checkout, opt-in per project via `runner.config.json`'s `push.enabled` —
> direct pushes to the base/protected branch are refused. **Opening a Pull
> Request from that pushed branch is now implemented**
> ([#30](https://github.com/bao-linfeng/AgentDock/issues/30),
> `apps/server/src/github/pull-request.service.ts`): once a run reports a
> pushed commit but is otherwise missing the `pull_request` evidence, the
> Control Server (which holds the GitHub App credentials from
> [#28](https://github.com/bao-linfeng/AgentDock/issues/28)) opens the PR
> itself and re-evaluates completion — so `fix`/`implement` runs against a
> project with exactly one bound repository now complete as `succeeded`
> instead of failing on evidence. Posting a callback comment back to the
> originating GitHub thread is still open
> ([#31](https://github.com/bao-linfeng/AgentDock/issues/31)).
> The **Web console is now built**
> (Dashboard, Task List, Task Detail with live SSE updates, Projects — see
> [Milestone 7](#-roadmap)). Progress and the issue mapping are tracked in
> [`docs/tasks.md`](./docs/tasks.md) and the
> [GitHub issues](https://github.com/bao-linfeng/AgentDock/issues).

---

## 📖 Overview

**AgentDock** is a **local-first control plane** for coding agents, aimed at
individual developers and small teams.

The vision: from anywhere — a web browser, your phone, or a `@agent` comment on
a GitHub Issue/PR — you dispatch code-fix, feature, and code-review tasks to the
coding agent (such as [OpenCode](https://github.com/sst/opencode)) running on
**your own machine**. A local Runner keeps in touch with the cloud control
server via an **outbound connection only**, so you **never expose an inbound
port or configure tunneling**. Your source code and model credentials always
stay on your local machine.

### 💡 Core Design Principles

1. **Strict separation of Control Plane and Agent Runtime** — The cloud handles
   only task scheduling, permission checks, event distribution, and status
   display. It never touches source code or model keys. The local Runner owns
   the execution environment, Git isolation, testing, and building.
2. **Local-first & privacy** — Code repositories, local dependencies, and LLM
   API keys live only on your local dev machine.
3. **Protocol-first** — Built on standardized agent protocol models
   (`AgentTask` / `AgentRun` / `RunEvent` / `RunArtifact`), normalizing every
   entry point (GitHub, Web UI, …) into a single representation.
4. **External orchestration decoupled from internal orchestration** — The
   Control Server only knows `executor = opencode`. Any internal agent
   orchestration inside OpenCode is not exposed to the Control Server.
5. **Evidence-based governance** — Whether a task is "done" is decided by
   objective evidence (code diff, passing tests, Git commit, PR creation), not
   by the agent's natural-language reply.
6. **Physical isolation via Git worktrees** — Every change an agent makes
   happens inside a dedicated Git worktree, never polluting the workspace or an
   unprotected main branch directly.

---

## ✨ Features

> The following describe the **target** capabilities. See the
> [Roadmap](#-roadmap) for what is implemented today (foundation packages built
> and tested; end-to-end loop in progress).

- 🔒 **Local-first, zero inbound ports** — A local Runner on Windows/macOS/Linux
  actively polls or holds an outbound connection to the cloud Control Server.
  Works seamlessly behind NAT and corporate networks.
- 🤖 **Standardized Agent Client Protocol (ACP)** — Interacts with OpenCode and
  similar agents through a structured ACP protocol, capturing tool calls, log
  streams, and artifacts precisely — no fragile stdout regex parsing.
- 🌿 **Git worktree isolation** — Each Run automatically creates a dedicated
  branch and worktree, runs the configured test command, commits, and can open
  a Pull Request automatically.
- 🐙 **GitHub-native, event-driven** — Trigger tasks with `@agent` in Issue / PR
  comments. When a run finishes, results (logs, test outcome, linked PR) are
  posted back to the original thread.
- 📱 **Mobile-friendly monitoring console** — View task status (Queued,
  Assigned, Running, Verifying, Publishing, Succeeded), live logs, diffs, and a
  one-tap cancel.
- 🛡️ **Sandboxing & auditability** — Strict workspace-root containment,
  sensitive token/secret redaction, and an auditable trail of operations.

---

## 🏗️ Architecture

```text
                       ┌──────────────────────┐
                       │   Mobile / Web UI    │
                       │ Dashboard / Task UI  │
                       └──────────┬───────────┘
                                  │ HTTPS / SSE / WebSocket
                                  ▼
┌──────────────┐          ┌──────────────────────┐
│    GitHub    │─────────▶│    Control Server    │
│ Webhook/API  │          │       (NestJS)       │
└──────────────┘          │                      │
                          │ Auth & Permissions   │
                          │ Project / Repo Mgmt  │
                          │ GitHub Normalizer    │
                          │ Task Engine & Queue  │
                          │ Runner Gateway       │
                          │ Event & Artifact Hub │
                          └───────┬──────────────┘
                                  │
                                  ▼
                             ┌─────────┐
                             │  MySQL  │
                             │(Prisma) │
                             └─────────┘

       Local Dev Machine (Windows / macOS / Linux)
──────────────────────────────────────────────────────────
                  Outbound HTTPS / WebSocket
                                  │
                          ┌───────▼────────┐
                          │  Local Runner  │
                          │                │
                          │ Heartbeat      │
                          │ Task Claim     │
                          │ Workspace Cwd  │
                          │ Worktree Mgmt  │
                          │ ACP Client     │
                          └───────┬────────┘
                                  │
                                  ▼
                            ┌───────────┐
                            │ OpenCode  │
                            │   (ACP)   │
                            └─────┬─────┘
                                  │
                                  ▼
                            Git Worktree
                                  │
                            test / build
                                  │
                            commit / push
                                  │
                                  ▼
                               GitHub PR
```

### Control Server vs. Local Runner

| Control Server (cloud, NestJS)            | Local Runner (your machine)              |
| ----------------------------------------- | ---------------------------------------- |
| Authentication & permissions             | Runner registration & heartbeat          |
| Project / Repository / Runner config      | Project-path mapping                     |
| GitHub webhook normalization              | Git worktree lifecycle                   |
| Task creation & Task/Run state machine    | OpenCode ACP execution                   |
| Runner task assignment                    | Process lifecycle & cancellation         |
| Event persistence & artifact metadata     | Test / build execution                   |
| Web API + SSE/WebSocket                   | Commit / push                            |
| Evidence-based completion decision        | Artifact collection & progress streaming |
| **Never** touches source or model keys    | **Never** stores model provider keys     |

---

## 🔁 Task State Machine

```text
queued ──▶ assigned ──▶ running ──▶ verifying ──▶ publishing ──▶ succeeded
                          │
                          ├──▶ needs_approval
                          ├──▶ failed
                          └──▶ cancelled
```

`verifying` and `publishing` are added on top of the core states to let the UI
clearly show the test → commit → push → PR phases.

### Core Protocol Models

The system normalizes every entry point into these models (see
[`docs/requirements.md`](./docs/requirements.md)):

- **`AgentTask`** — A unit of intent (`fix` / `implement` / `review` / `test` /
  `general`) from a source (`web` / `github`).
- **`AgentRun`** — A single execution attempt of a task by an executor
  (`opencode`), tracking branch, worktree path, and status.
- **`RunEvent`** — An ordered event stream item (`status` / `log` / `tool` /
  `artifact` / `verification` / `error`).
- **`RunArtifact`** — A produced output (`diff` / `file` / `test_result` /
  `commit` / `pull_request`).

---

## 📁 Project Structure

> Monorepo layout (pnpm workspace). Foundation packages under `packages/` and
> `apps/server` are implemented and tested; `apps/runner` and `apps/web` are
> still scaffolds — see [Project Status](#-overview).

```text
AgentDock/
├── apps/
│   ├── server/           # NestJS control plane (Task Engine / GitHub Adapter / Runner Gateway / API)
│   ├── runner/           # Local Runner client (ACP driver / Git worktree / process lifecycle)
│   └── web/              # Web console & mobile dashboard (Vue 3 / Vite / Pinia / TanStack Query)
│
├── packages/
│   ├── protocol/         # Core data models & Zod schemas (AgentTask, AgentRun, RunEvent, Artifact)
│   ├── agent-runtime/    # Agent executor abstraction & ACP client
│   ├── git-runtime/      # Git worktree management, change detection & branch ops
│   ├── github-adapter/   # GitHub webhook normalization & API callbacks
│   ├── task-engine/      # Task state machine & scheduling engine
│   ├── governance/       # Evidence validation & completion rules engine
│   └── shared/           # Common utilities & constants
│
├── docs/                 # Architecture, requirements & task-breakdown docs
│   ├── requirements.md
│   ├── architecture.md
│   └── tasks.md
│
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 🧰 Tech Stack

> Recommended stack from [`docs/architecture.md`](./docs/architecture.md).

| Area           | Technologies                                                        |
| -------------- | ------------------------------------------------------------------- |
| `apps/server`  | NestJS · Prisma · MySQL 8 · WebSocket/SSE · Octokit (Redis optional, not required for MVP) |
| `apps/runner`  | Node.js 22+ · TypeScript · ACP client/runtime · simple-git or Git CLI via child_process · Zod |
| `apps/web`     | Vue 3 · Vite · TypeScript · Pinia · TanStack Query · shadcn-vue or Element Plus |
| Tooling        | pnpm workspace (Monorepo)                                           |

---

## 🚀 Getting Started

> [!IMPORTANT]
> The **Control Server runs today** (Milestone 2), the **Local Runner now runs
> the full claim→execute→push loop** (Milestone 3/5 — see step 3 below), and
> the **Web console is now built** (Milestone 7 — see step 4 below). The
> Control Server now opens a Pull Request automatically once a run pushes a
> commit ([#30](https://github.com/bao-linfeng/AgentDock/issues/30)), so step 3
> reflects what actually runs today end to end: push (opt-in per project) →
> Control Server opens the PR → run completes as `succeeded`. Posting a
> callback comment on the originating GitHub thread is still open (#31). See
> [Roadmap](#-roadmap).

### Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `>= 10.0.0`
- **MySQL** `>= 8.0` (or Docker: `pnpm db:up`)
- **Git** `>= 2.30.0`
- **OpenCode** installed locally with model credentials configured

### 1. Install dependencies

```bash
git clone https://github.com/bao-linfeng/AgentDock.git
cd AgentDock
pnpm install
```

### 2. Configure & start the Control Server

```bash
pnpm db:up            # MySQL 8 via Docker (MYSQL_PORT=3307 if 3306 is taken)
cd apps/server
cp env.example .env
```

```env
DATABASE_URL="mysql://root:agentdock@localhost:3306/agentdock"
PORT=3100
PUBLIC_BASE_URL="https://your-tunnel.example.com"
# Two independent static tokens (MVP has no users table). Generate strong values:
#   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
API_AUTH_TOKEN="your-web-token"
RUNNER_TOKEN="your-runner-token"
GITHUB_WEBHOOK_SECRET=""
GITHUB_APP_ID=""
GITHUB_PRIVATE_KEY=""
```

```bash
pnpm prisma:migrate   # create the schema
pnpm dev              # http://localhost:3100/health
```

The full endpoint list (Web API + Runner Gateway) lives in
[`apps/server/README.md`](./apps/server/README.md). Every route except
`GET /health` requires a token, and the runner and web tokens must differ.

### 3. Configure & start the Local Runner

```bash
cd apps/runner
cp runner.config.example.json runner.config.json
```

```json
{
  "serverUrl": "http://localhost:3100",
  "runnerToken": "your-runner-token-generated-from-server",
  "runnerName": "my-dev-workstation",
  "projects": {
    "proj_123": {
      "workspacePath": "/path/to/local/project",
      "defaultBranch": "main",
      "push": {
        "enabled": false,
        "remote": "origin",
        "protectedBranches": []
      }
    }
  }
}
```

```bash
pnpm start
```

The runner registers, heartbeats, and starts polling
`GET /runner/tasks/claim` every 5s; once a task is queued for a mapped
project it creates an isolated worktree, runs OpenCode via ACP, verifies
(optional test command), commits locally, and — if `push.enabled` is set for
that project — pushes the agent branch to the configured remote (reusing
whatever git credentials are already set up locally; direct pushes to the
base/protected branch are refused). Once the Control Server sees a pushed
commit, it opens a Pull Request itself (#30, using the GitHub App credentials
from repository binding — this requires the target project to have exactly
one bound repository), so `fix`/`implement` tasks now complete as
`succeeded` end to end; `general` tasks (no PR requirement) complete
normally regardless. Posting the run's outcome back as a GitHub comment is
still open (#31).

### 4. Start the Web console

```bash
cd apps/web
pnpm dev
```

Then open `http://localhost:5173` and sign in with your `API_AUTH_TOKEN`. The
console proxies `/api/*` to the Control Server in dev (see
`apps/web/vite.config.ts`).

---

## 🔄 Typical Workflows

### Scenario A — Dispatch from Web / mobile

1. Open the web console and select a target project (e.g. `PaymentService`).
2. Enter a prompt: *"Fix the duplicate-processing bug in the payment callback and add relevant unit tests."*
3. The Control Server creates a Task and queues it.
4. The local Runner claims the task and creates an isolated worktree at `.agent-worktrees/run-xxx`.
5. OpenCode (via ACP) analyzes the code, applies the fix, and runs tests.
6. Once verification passes, it commits, pushes, and opens a PR.
7. The web console shows live logs and the PR link.

### Scenario B — GitHub Issue integration

1. Comment on an Issue in a bound repository: `@agent fix the duplicate payment-callback processing`.
2. A GitHub webhook notifies the Control Server, which normalizes it into an `AgentTask`.
3. The local Runner claims and executes it, then replies on the original Issue with a summary, changed files, and the Pull Request link.

---

## 🗺️ Roadmap

Milestones and progress are tracked in [`docs/tasks.md`](./docs/tasks.md), with a
full task ↔ issue cross-reference table. Legend: ✅ done · 🟡 partial · ⬜ todo.
Foundation packages (#1–#5) are merged; the end-to-end loop is next.

- ⬜ **Milestone 0 — Technical validation & protocol definition** ([#16](https://github.com/bao-linfeng/AgentDock/issues/16) [#17](https://github.com/bao-linfeng/AgentDock/issues/17) [#18](https://github.com/bao-linfeng/AgentDock/issues/18))
  - OpenCode ACP smoke test · OMO Slim compatibility spike · OpenTag runner code reading
- 🟡 **Milestone 1 — Monorepo & Protocol package** *(done)*
  - ✅ pnpm workspace scaffolding
  - ✅ `@agentdock/protocol` Zod schemas & Run status state machine (`CallbackRoute` / JSON Schema export still pending)
- ✅ **Milestone 2 — Control Server foundation** *(done)* (epic [#6](https://github.com/bao-linfeng/AgentDock/issues/6): [#19](https://github.com/bao-linfeng/AgentDock/issues/19) [#20](https://github.com/bao-linfeng/AgentDock/issues/20) [#21](https://github.com/bao-linfeng/AgentDock/issues/21) [#22](https://github.com/bao-linfeng/AgentDock/issues/22))
  - ✅ NestJS modules (Auth / Projects / Tasks / Runs / Runners / GitHub / Events)
  - ✅ Prisma schema & MySQL migration · Project CRUD
  - ✅ Runner Gateway (claim / events / heartbeat / complete) with cancellation via the heartbeat response
- 🟡 **Milestone 3 — Local Runner** ([#23](https://github.com/bao-linfeng/AgentDock/issues/23) [#24](https://github.com/bao-linfeng/AgentDock/issues/24))
  - ✅ Runner config safety & secret handling ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ✅ Task-claim engine core ([#3](https://github.com/bao-linfeng/AgentDock/issues/3))
  - ✅ Runner-side registration/heartbeat loop (#23) · ✅ claim→execute loop (#24)
- 🟡 **Milestone 4 — Agent Runtime** (epic [#7](https://github.com/bao-linfeng/AgentDock/issues/7): [#25](https://github.com/bao-linfeng/AgentDock/issues/25) [#26](https://github.com/bao-linfeng/AgentDock/issues/26))
  - ✅ `AgentExecutor` interface
  - ✅ OpenCode ACP executor · ACP → RunEvent bridge (via `@agentclientprotocol/sdk`; see `packages/agent-runtime`)
- ✅ **Milestone 5 — Git Runtime** *(done)* ([#27](https://github.com/bao-linfeng/AgentDock/issues/27))
  - ✅ Worktree manager, change detection, verification ([#1](https://github.com/bao-linfeng/AgentDock/issues/1))
  - ✅ Commit (local, via #24) · ✅ Push new branch + refuse direct push to base/protected branches ([#27](https://github.com/bao-linfeng/AgentDock/issues/27))
- 🟡 **Milestone 6 — GitHub integration** ([#28](https://github.com/bao-linfeng/AgentDock/issues/28) [#29](https://github.com/bao-linfeng/AgentDock/issues/29) [#30](https://github.com/bao-linfeng/AgentDock/issues/30) [#31](https://github.com/bao-linfeng/AgentDock/issues/31))
  - ✅ Event normalizer & `@agent` mention trigger ([#2](https://github.com/bao-linfeng/AgentDock/issues/2))
  - ✅ GitHub App/Installation auth & repository↔project binding ([#28](https://github.com/bao-linfeng/AgentDock/issues/28), `apps/server/src/github`)
  - ✅ Webhook signature verification & delivery dedupe ([#29](https://github.com/bao-linfeng/AgentDock/issues/29))
  - ✅ PR creation ([#30](https://github.com/bao-linfeng/AgentDock/issues/30), `apps/server/src/github/pull-request.service.ts`) · ⬜ callback comments ([#31](https://github.com/bao-linfeng/AgentDock/issues/31))
- ⬜ **Milestone 7 — Web Dashboard & mobile UX** (epic [#8](https://github.com/bao-linfeng/AgentDock/issues/8): [#32](https://github.com/bao-linfeng/AgentDock/issues/32)–[#36](https://github.com/bao-linfeng/AgentDock/issues/36))
  - ✅ Dashboard, task list, task detail (timeline/output/logs/diff/tests/artifacts), mobile UX
  - ✅ Projects (CRUD + Runner mapping + repository binding, via #28; webhook-triggered dispatch now live via #29)
- 🟡 **Milestone 8 — Governance** ([#37](https://github.com/bao-linfeng/AgentDock/issues/37))
  - ✅ Evidence engine & evidence-based completion decision ([#4](https://github.com/bao-linfeng/AgentDock/issues/4))
  - ⬜ Approval model (phase 2)
- ✅ **Milestone 9 — Stability** (epic [#9](https://github.com/bao-linfeng/AgentDock/issues/9): [#38](https://github.com/bao-linfeng/AgentDock/issues/38) [#39](https://github.com/bao-linfeng/AgentDock/issues/39) [#40](https://github.com/bao-linfeng/AgentDock/issues/40))
  - ✅ Secret redaction ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ✅ Idempotency: task dedupe keys, atomic claim, guarded complete ([#40](https://github.com/bao-linfeng/AgentDock/issues/40))
  - ✅ Runner disconnect handling (heartbeat-timeout sweep fails orphaned runs) · retry (new run id, history kept) ([#38](https://github.com/bao-linfeng/AgentDock/issues/38) [#39](https://github.com/bao-linfeng/AgentDock/issues/39))

### Explicitly out of scope (until the single-machine OpenCode + GitHub loop works)

Slack / Feishu / Telegram · Claude / Codex / PI executors · multi-tenant ·
multi-Runner lease scheduling · auto-merge · full browser IDE · Docker sandbox ·
parallel multi-agent · scheduled tasks · complex approval flows · workflow DSL.

---

## 🤝 Contributing

AgentDock is in early development — the foundation packages are built and the
end-to-end loop is being assembled. Good ways to contribute right now:

- Pick up an open [issue](https://github.com/bao-linfeng/AgentDock/issues) (see the
  task ↔ issue table in [`docs/tasks.md`](./docs/tasks.md)).
- Read the design docs in [`docs/`](./docs) and open feedback on requirements,
  architecture, or the task breakdown.

- [`docs/requirements.md`](./docs/requirements.md) — Goals, MVP scope, data models, security requirements
- [`docs/architecture.md`](./docs/architecture.md) — System boundaries, tech stack, protocols, database, workflows
- [`docs/tasks.md`](./docs/tasks.md) — Milestone-by-milestone task breakdown

---

## 📄 License

Released under the [MIT License](LICENSE).
