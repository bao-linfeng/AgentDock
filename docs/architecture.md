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
}
```

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

> **[TODO]** 缺少 `users` 表：`tasks.created_by` 与 AuthModule / JWT 依赖用户实体，但下方无 `users` 定义。请补最小 `users` 表，或明确 MVP 用单一静态 token。
>
> **[TODO]** `runners` 表缺少 token 相关字段：安全要求"Runner Token 独立且可撤销"（requirements.md §10），需新增 `token_hash` / `revoked` / `revoked_at`。
>
> **[OPEN QUESTION]** `projects.workspace_key` 与 `runner_projects.workspace_path` 的关系未说明：`workspace_key` 是逻辑标识、`workspace_path` 是各 Runner 本地实际路径？需明确 root containment 校验相对哪个根、由谁执行。

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
intent
prompt
status
created_by
created_at
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
action
status
requested_at
resolved_at
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
  ├── needs_approval
  ├── failed
  ├── cancelled
  └── verifying
         ↓
      publishing
         ↓
      succeeded
```

说明：

- OpenTag V0 的核心状态可直接借鉴。
- 本项目额外增加 `verifying` 和 `publishing`，方便 UI 显示测试、Commit、Push、PR 阶段。

---

## 9. Runner 通信

MVP 推荐：

```text
Runner → GET /runner/tasks/claim
Runner → POST /runner/runs/:id/events
Runner → POST /runner/runs/:id/heartbeat
Runner → POST /runner/runs/:id/complete
```

> **[OPEN QUESTION — 取消信号下发缺口]** US-04 要求可取消（Web→Control 标记 cancelling→Runner 收到→ACP cancel），但上述纯出站轮询端点中没有任何"接收取消信号"的通道。Runner 运行中如何得知被取消？需明确机制：例如 `heartbeat` 响应体携带 `cancelRequested` 标志，或新增长轮询/SSE 下行通道。这是功能级缺口，须在定协议时一并设计。

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

- Approvals
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
