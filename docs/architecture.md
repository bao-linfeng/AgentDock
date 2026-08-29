# OpenCode Remote — Architecture

## 1. 总体架构

```text
                       ┌──────────────────────┐
                       │       iPhone/Web     │
                       │ Dashboard / Task UI  │
                       └──────────┬───────────┘
                                  │ HTTPS
                                  ▼
┌──────────────┐          ┌──────────────────────┐
│    GitHub    │─────────▶│    Control Server    │
│ Webhook/API  │          │       NestJS         │
└──────────────┘          │                      │
                          │ Auth                 │
                          │ Projects             │
                          │ GitHub Adapter       │
                          │ Task Engine          │
                          │ Runner Gateway       │
                          │ Events / Artifacts   │
                          └───────┬──────────────┘
                                  │
                             MySQL│
                                  ▼
                             ┌─────────┐
                             │ Prisma  │
                             └─────────┘

       Windows 11
──────────────────────────────────────────────────────────
                  outbound HTTPS / WebSocket
                                  │
                          ┌───────▼────────┐
                          │  Local Runner  │
                          │                │
                          │ Heartbeat      │
                          │ Task Claim     │
                          │ Workspace      │
                          │ Git            │
                          │ ACP Runtime    │
                          └───────┬────────┘
                                  │
                                  ▼
                            ┌───────────┐
                            │ OpenCode  │
                            │    ACP    │
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

---

## 2. 系统边界

### Control Server

负责：

- 身份认证
- Project / Repository / Runner 配置
- GitHub Webhook
- Task 创建
- Task / Run 状态机
- Runner 任务分配
- Event 持久化
- Artifact 元数据
- Web API
- SSE/WebSocket
- GitHub Callback
- Evidence 判断

不负责：

- 直接启动 OpenCode
- 访问用户本地项目文件
- 保存模型 Provider Key
- 执行 npm test
- 执行 Git Commit

### Local Runner

负责：

- Runner 注册和心跳
- Project Path 映射
- Worktree
- Git
- OpenCode ACP
- Process lifecycle
- Cancellation
- Test / Build
- Commit / Push
- Artifact 收集
- Progress streaming

---

## 3. Monorepo

```text
opencode-remote/
├─ apps/
│  ├─ web/
│  ├─ server/
│  └─ runner/
│
├─ packages/
│  ├─ protocol/
│  ├─ agent-runtime/
│  ├─ github-adapter/
│  ├─ task-engine/
│  ├─ governance/
│  ├─ git-runtime/
│  └─ shared/
│
├─ docs/
│  ├─ requirements.md
│  ├─ architecture.md
│  └─ tasks.md
│
└─ pnpm-workspace.yaml
```

---

## 4. 推荐技术栈

### apps/web

建议：

- Vue 3
- Vite
- TypeScript
- Pinia
- TanStack Query
- shadcn-vue 或 Element Plus

> **[已实现 2026-08-29]** M7（#8/#32–#36）实际采用 TailwindCSS v4 + shadcn-vue
> （见项目协作规则第 5/6 条）而非手写 CSS：`apps/web` 通过 `@tailwindcss/vite`
> 接入 Tailwind，UI 原语组件用 shadcn-vue CLI 拷贝到 `src/components/ui/`；
> Vue 3 / Vite / TypeScript / Pinia / TanStack Query 均按此表实现。

### apps/server

- NestJS
- Prisma
- MySQL 8
- Redis：MVP 可不引入
- WebSocket / SSE
- Octokit

### apps/runner

- Node.js 22+
- TypeScript
- ACP client/runtime
- simple-git 或 child_process 调 Git CLI
- Zod

---

## 5. 核心协议

### AgentExecutor

```ts
export interface AgentExecutor {
  id: string;

  canRun(input: ExecutorRunInput): Promise<ExecutorReadiness>;

  run(
    input: ExecutorRunInput,
    sink: ExecutorEventSink
  ): Promise<ExecutorRunResult>;

  cancel(runId: string): Promise<void>;
}
```

### ExecutorRunInput

```ts
export interface ExecutorRunInput {
  runId: string;
  workspaceCwd: string;
  prompt: string;
  context: ContextPointer[];
  permissions: PermissionGrant[];
}
```

### ExecutorEventSink

```ts
export interface ExecutorEventSink {
  status(status: RunStatus): Promise<void>;
  log(message: string): Promise<void>;
  artifact(artifact: RunArtifact): Promise<void>;
  verification(result: VerificationResult): Promise<void>;
  error(message: string, code?: string): Promise<void>;
}
```

> **[已实现 2026-08-29]** `error` 由 #26（T4.3 事件桥接）补充：ACP 侧的致命/非致命
> 错误（连接失败、agent 拒绝、失败的 tool call）需要一个独立通道区分于普通
> `log`，实现见 `packages/agent-runtime/src/index.ts`。

---

## 6. OpenTag 映射

### [参考 OpenTag: core]

映射到：

```text
packages/protocol
```

吸收：

- Event
- Run
- Status
- Context Pointer
- Permission Grant
- Callback Route
- JSON Schema / Zod

### [参考 OpenTag: runner]

映射到：

```text
packages/agent-runtime
apps/runner
```

吸收：

- Executor interface
- ACP launcher
- timeout
- cancellation
- readiness
- structured result
- progress event

### [参考 OpenTag: github]

映射到：

```text
packages/github-adapter
apps/server/src/github
```

吸收：

- GitHub event normalization
- issue / PR / comment context
- callback route
- status comment

### [参考 OpenTag: dispatcher]

映射到：

```text
apps/server/src/tasks
apps/server/src/runners
packages/task-engine
```

借思想，不要求原样复制。

### [参考 OpenTag: store]

不建议直接用。

改成：

```text
NestJS + Prisma + MySQL
```

### [参考 OpenTag: governance]

映射到：

```text
packages/governance
```

第二阶段启用。

---

## 7. 数据库

> **[已决策 2026-08-29]** 不建 `users` 表：MVP 采用两个独立静态 token（`API_AUTH_TOKEN` 用于 Web，`RUNNER_TOKEN` 用于 Runner），无登录流程 / JWT。`tasks.created_by` 退化为自由文本（例如 GitHub 用户名），不外键关联。
>
> **[已实现]** `runners` 增加 `token_hash` / `revoked` / `revoked_at`（requirements.md §10）：只存哈希，可单独撤销。
>
> **[已澄清]** `projects.workspace_key` 是**逻辑标识**（服务端与 Runner 共用的项目键，不含路径）；`runner_projects.workspace_path` 是**该 Runner 本机的绝对路径**。root containment 校验相对 Runner 本地配置的 `allowedRoots`，由 **Runner** 执行（Control Server 不访问本地文件系统）；Server 只负责保证"未映射 / 未启用的项目不会被领取"。
>
> **[实现补充]** 表名映射为下列 snake_case 名称，列名沿用 Prisma 的 camelCase；`task_runs` 另有 `cancel_requested_at`（见 §9）与 `created_at` / `updated_at`，`tasks` 另有 `delivery_id`（GitHub 投递去重）与 `callback_repo` / `callback_issue_number` / `callback_is_pull_request`（GitHub 状态回帖目标，§11 / #31：仅 `source = github` 的任务会写入，指向触发该任务的 Issue/PR 线程）。

### projects

```text
id
name
workspace_key
default_branch
test_command
build_command
created_at
updated_at
```

### repositories

```text
id
project_id
provider
owner
repo
installation_id
created_at
```

### runners

```text
id
name
machine_name
platform
version
status
token_hash
revoked
revoked_at
last_heartbeat_at
created_at
```

### runner_projects

```text
runner_id
project_id
workspace_path
enabled
```

### tasks

```text
id
project_id
source
source_ref
delivery_id
intent
prompt
status
created_by
callback_repo
callback_issue_number
callback_is_pull_request
created_at
updated_at
```

### task_runs

```text
id
task_id
runner_id
executor
status
branch
worktree_path
started_at
finished_at
error_code
error_message
cancel_requested_at
created_at
updated_at
```

### run_events

```text
id
run_id
seq
type
payload_json
created_at
```

### artifacts

```text
id
run_id
type
title
uri
metadata_json
created_at
```

### approvals

```text
id
run_id
action        -- shell | push | destructive (docs/tasks.md T8.3, #37)
status        -- pending | approved | denied
summary
detail_json
requested_at
resolved_at
resolved_by
```

---

## 8. Task 状态机

> **[TODO — 权威来源]** 本节状态机为全项目状态词汇的**唯一权威来源**。requirements.md §5 `AgentRun.status` 与 US-03 存在不一致命名，须以本节为准回填统一。

```text
queued
  ↓
assigned
  ↓
running
  ├── needs_approval ──┐
  ├── failed           │ (loops back to running / verifying / publishing)
  ├── cancelled         │
  └── verifying ←───────┘
         ↓
      publishing ←→ needs_approval
         ↓
      succeeded
```

说明：

- OpenTag V0 的核心状态可直接借鉴。
- 本项目额外增加 `verifying` 和 `publishing`，方便 UI 显示测试、Commit、Push、PR 阶段。
- `needs_approval` 是一个可重入的"侧支"状态（docs/tasks.md T8.3, #37）：`running`
  或 `publishing` 中遇到高风险操作（shell 工具调用 / push / 破坏性操作）时可以
  转入 `needs_approval`，审批通过或拒绝后回到发起该请求的状态（`running` /
  `verifying` / `publishing`）继续或中止，而不会绕过 `verifying` →
  `publishing` 直接到达 `succeeded`。

---

## 9. Runner 通信

MVP 实现（已完成，#22；审批相关端点见 #37）：

```text
Runner → POST /runner/register
Runner → GET  /runner/tasks/claim
Runner → POST /runner/runs/:id/events
Runner → POST /runner/runs/:id/heartbeat      # 返回 { cancelRequested, approval? }
Runner → POST /runner/runs/:id/approvals      # 请求审批（shell/push/destructive）
Runner → POST /runner/runs/:id/complete
Runner → POST /runner/heartbeat          # 空闲心跳
```

> **[已实现 2026-08-30 — 审批下发, #37]** 与取消信号同理，审批决议也走
> **heartbeat 响应**：Runner 遇到高风险操作（ACP `session/request_permission`
> 请求的 shell 工具调用、`push`、或标记为 `destructive` 的操作）时调用
> `POST /runner/runs/:id/approvals` 创建一条 pending `Approval` 并将 Run 转入
> `needs_approval`；随后持续轮询 `POST /runner/runs/:id/heartbeat`，其响应体的
> `approval` 字段带回该审批的最新状态。Web 端调用
> `POST /approvals/:id/resolve`（`{ decision: 'approved' | 'denied' }`）完成
>人工决议。等待期间 Runner 会阻塞对应操作（ACP 侧是阻塞 agent 进程本身，不
> kill 掉），超时（默认 24h）未决议按拒绝处理，不会让 Run 无限期挂起。

> **[已决策 2026-08-29 — 取消信号下发]** 取消走 **heartbeat 响应**：Web 调用
> `POST /runs/:id/cancel` 时，Server 给 `task_runs.cancel_requested_at` 打时间戳；
> Runner 的下一次 `POST /runner/runs/:id/heartbeat` 收到 `{ cancelRequested: true }`
> 后调用 ACP cancel，并以 `complete { status: 'cancelled' }` 收尾。**不新增
> `cancelling` 状态**，§8 仍是状态词汇的唯一权威来源。尚未被领取的 Run 由 Server
> 直接置为 `cancelled`，无需 Runner 参与。因此不需要任何指向 Runner 的入站通道。

补充约定：

- claim 是单条条件 UPDATE（`WHERE status='queued' AND runner_id IS NULL`），并发 claim 不会重复领取；MVP 单 Runner 同时只跑一个任务。
- Runner 只能领取"已映射且启用"的项目（§14）。
- `status` 事件驱动状态机；`succeeded` 必须先经过 `verifying` → `publishing`。
- RunEvent payload 落库前统一过 `redactSecrets`（§14）。

Web 实时状态：

```text
Runner
   ↓
Control Server
   ↓
DB
   ↓
SSE/WebSocket
   ↓
Web
```

### 为什么不用 NPS

Runner 主动出站连接云端：

- 无需暴露 Windows 端口。
- 无需给 OpenCode API 配公网入口。
- 家庭 / 公司网络环境更容易工作。
- 安全边界更清楚。

---

## 10. Git Runtime

```text
Project Root
    │
    ├── main checkout
    │
    └── .agent-worktrees/
          └── <run-id>/
```

生命周期：

1. `git fetch`
2. 基于 default branch 创建 agent branch
3. `git worktree add`
4. OpenCode 使用 Worktree 为 cwd
5. Test / Build
6. Commit
7. Push
8. PR
9. Run 完成后可配置清理 Worktree

---

## 11. GitHub Workflow

```text
Issue Comment
      │
      ▼
Webhook Verify
      │
      ▼
Mention Detector
      │
      ▼
GitHub Event Normalizer
      │
      ▼
Task Engine
      │
      ▼
Runner Claim
      │
      ▼
OpenCode
      │
      ▼
Git / Test
      │
      ▼
PR
      │
      ▼
GitHub Callback
```

---

## 12. OpenCode + OMO Slim

### 外层

```text
Control Server
   ↓
OpenCode Executor
```

### 内层

```text
OpenCode
   ↓
oh-my-opencode-slim
   ↓
orchestrator
   ├─ designer
   ├─ explorer
   └─ fixer
```

> **[TODO — 描述与实物核对]** oh-my-opencode-slim 真实存在（https://github.com/alvinunreal/oh-my-opencode-slim ），但其内部专职 agent 命名与上图的 `designer / explorer / fixer` 不完全吻合（实际为 scout / docs / review / UI / implementation 一类）。因架构已声明"禁止 Control Server 依赖这些名字"，不影响设计，但**此处示意文字应按实际插件更新**。

禁止 Control Server 直接依赖 OMO Slim 的 agent 名称。

这样即使以后换：

```text
OpenCode
↓
其他编排插件
```

Control Server 无需修改。

---

## 13. UI 架构

### [参考 OpenHands]

页面：

```text
Dashboard
Projects
Tasks
Task Detail
  ├─ Timeline
  ├─ Agent Output
  ├─ Logs
  ├─ Diff
  ├─ Tests
  └─ Artifacts
Runners
Settings
```

参考重点：

- Conversation 与执行日志分开。
- Terminal/Log/Files/Artifact 是 UI 能力，不进入 Agent Runtime。
- 前端只调用 Control Server API。

### [参考 Orca]

> **[已核实 2026-08-29]** Orca = https://github.com/stablyai/orca（stablyai，MIT）。桌面 + 移动 + VPS 的多 agent ADE，含移动 Companion、并行/SSH Worktree、GitHub/Linear 原生集成、完成通知与 diff 批注。以下移动端参考准确可靠。

重点借鉴：

- Mobile-first Task Detail
- Agent 是否 Working / Blocked / Idle
- Project / Worktree 列表
- 任务完成后的通知
- 从通知 deep-link 到具体 Run

不要求复制 Orca 的 Runtime。

---

## 14. 安全边界

```text
GitHub Public Internet
        │
        ▼
Control Server
        │
        │ Authenticated outbound channel
        ▼
Local Runner
        │
        ▼
Allowed Workspace
```

规则：

- Runner 不执行未知 Project。
- Worktree cwd 必须通过 root containment check。
- GitHub webhook 必须验签。
- Runner API 使用独立 token。
- Secret 不写 RunEvent。
- stdout/stderr 必须做敏感信息过滤。
- direct push to protected branch = forbidden。
- PR-first。

---

## 15. 后续扩展

### Phase 2

- ~~Approvals~~ — 已实现（docs/tasks.md T8.3, #37）：shell / push / destructive
  三类高风险操作审批门，见 §9 Runner 通信与 §7 `approvals` 表。
- CI 状态回流
- PR Review Agent
- Task Retry
- Run Resume
- Browser Notification

### Phase 3

- 多 Runner
- Codex / Claude Executor
- PI Executor
- Slack / 飞书
- 多 Agent 并行
- Herdr Runtime
- Orca 风格手机 Companion
