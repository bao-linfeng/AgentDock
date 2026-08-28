# OpenCode Remote — Tasks

## Milestone 0 — 技术验证

目标：先证明 OpenCode ACP 路径可行。

### T0.1 OpenCode ACP Smoke Test

**类型：** Spike  
**优先级：** P0  
**标记：** `[参考 OpenTag] [可直接复用优先]`

验收：

- [ ] Node 可启动 OpenCode ACP
- [ ] 指定 `workspaceCwd`
- [ ] 提交一个简单 Prompt
- [ ] 能收到结构化 Progress
- [ ] 能收到 Final Result
- [ ] 能取消 Run
- [ ] 不依赖 TUI stdout parser

### T0.2 OMO Slim 兼容性验证

**优先级：** P0

验证：

- [ ] pure mode 下插件是否加载
- [ ] orchestrator 是否正常
- [ ] designer / fixer / explorer 委派是否正常
- [ ] 是否污染 ACP stdout
- [ ] cancel 是否正常
- [ ] cwd 是否始终位于 Worktree

结论输出：

```text
compatible
compatible_with_limitations
incompatible
```

### T0.3 OpenTag Runner Code Reading

**标记：** `[参考 OpenTag]`

> **[TODO — API 名以源码为准]** OpenTag 真实存在（https://github.com/amplifthq/opentag ）且高度对口，但下列符号名（`createAcpAgentExecutor` / `createBuiltInAcpExecutors` / built-in ACP agent definitions）是**假设的具体 API 名**。OpenTag 仍在活跃迭代，动工前必须实际核对当前源码，不能照抄这些名字。

重点定位：

- [ ] built-in ACP agent definitions
- [ ] createAcpAgentExecutor
- [ ] createBuiltInAcpExecutors
- [ ] workspace cwd conformance
- [ ] progress
- [ ] cancellation
- [ ] readiness

产出：

```text
docs/research/opentag-runner-notes.md
```

---

# Milestone 1 — Monorepo 与 Protocol

## T1.1 初始化 Monorepo

- [ ] pnpm workspace
- [ ] apps/web
- [ ] apps/server
- [ ] apps/runner
- [ ] packages/protocol
- [ ] packages/agent-runtime
- [ ] packages/github-adapter
- [ ] packages/task-engine
- [ ] packages/shared

## T1.2 Protocol Schema

**标记：** `[参考 OpenTag: core]`

实现 Zod Schema：

- [ ] AgentTask
- [ ] AgentRun
- [ ] RunEvent
- [ ] RunArtifact
- [ ] ContextPointer
- [ ] PermissionGrant
- [ ] CallbackRoute

要求：

- [ ] TypeScript 类型从 Schema 推导
- [ ] 可导出 JSON Schema
- [ ] Server / Runner 共用

## T1.3 Run Status State Machine

实现：

```text
queued
assigned
running
needs_approval
verifying
publishing
succeeded
failed
cancelled
```

- [ ] 非法状态跳转测试
- [ ] terminal state 不可继续运行

---

# Milestone 2 — Server 基础

## T2.1 NestJS Server

> **[TODO]** 模块列表含 `AuthModule`，但全套 tasks 无"用户管理 / 登录流程 / JWT 签发"的具体任务项，数据模型也缺 `users` 表（见 architecture.md §7 标注）。请补一个用户/认证实现任务，或明确 MVP 用单一静态 token 且不做 users。

模块：

- [ ] AuthModule
- [ ] ProjectsModule
- [ ] TasksModule
- [ ] RunsModule
- [ ] RunnersModule
- [ ] GitHubModule
- [ ] EventsModule

## T2.2 Prisma Schema

表：

- [ ] projects
- [ ] repositories
- [ ] runners
- [ ] runner_projects
- [ ] tasks
- [ ] task_runs
- [ ] run_events
- [ ] artifacts
- [ ] approvals

## T2.3 Project CRUD

- [ ] 创建项目
- [ ] 修改项目
- [ ] 删除项目
- [ ] 配 default branch
- [ ] 配 test command
- [ ] 配 build command

---

# Milestone 3 — Local Runner

## T3.1 Runner 配置

本地配置：

```json
{
  "serverUrl": "...",
  "runnerToken": "...",
  "runnerName": "...",
  "projects": {}
}
```

- [ ] 不存模型 API Key
- [ ] token 文件权限检查

## T3.2 Runner 注册

- [ ] register
- [ ] heartbeat
- [ ] online/offline
- [ ] version
- [ ] platform

## T3.3 Runner Project Mapping

```text
server project id
→
local workspace path
```

- [ ] 路径存在检查
- [ ] Git Repo 检查
- [ ] root containment

## T3.4 Task Claim

**标记：** `[参考 OpenTag: dispatcher]`

- [ ] Runner 主动 claim
- [ ] 单 Runner MVP
- [ ] 每次只执行一个任务
- [ ] claim 后 server 原子更新 assigned

---

# Milestone 4 — Agent Runtime

## T4.1 AgentExecutor Interface

**标记：** `[参考 OpenTag: runner]`

实现：

```ts
canRun()
run()
cancel()
```

## T4.2 OpenCodeExecutor

- [ ] ACP launcher
- [ ] cwd
- [ ] prompt
- [ ] context
- [ ] progress
- [ ] cancellation
- [ ] structured final result
- [ ] timeout

## T4.3 Executor Event Bridge

ACP Event：

```text
ACP
↓
ExecutorEvent
↓
Runner API
↓
RunEvent
```

- [ ] status
- [ ] log
- [ ] artifact
- [ ] verification
- [ ] error

---

# Milestone 5 — Git Runtime

## T5.1 WorktreeManager

- [ ] fetch
- [ ] create branch
- [ ] add worktree
- [ ] validate clean base
- [ ] cleanup

## T5.2 Git Change Detection

- [ ] changed files
- [ ] diff stats
- [ ] no-change detection

## T5.3 Verification

- [ ] run configured test command
- [ ] collect exit code
- [ ] collect bounded output
- [ ] create VerificationResult

## T5.4 Commit / Push

- [ ] commit
- [ ] configurable commit template
- [ ] push new branch
- [ ] 禁止 direct push default branch

---

# Milestone 6 — GitHub

## T6.1 GitHub App / Token 接入

- [ ] Webhook secret
- [ ] Installation auth
- [ ] Repository binding

## T6.2 Webhook Verification

- [ ] signature verify
- [ ] dedupe delivery id

## T6.3 Event Normalizer

**标记：** `[参考 OpenTag: github]`

支持：

- [ ] issue
- [ ] issue_comment
- [ ] pull_request
- [ ] review_comment

统一输出：

```text
AgentTaskCreateInput
```

## T6.4 Mention Trigger

默认：

```text
@agent
```

- [ ] allowlist
- [ ] ignore bot self-callback
- [ ] strip mention from prompt

## T6.5 Pull Request Creation

- [ ] title
- [ ] body
- [ ] base
- [ ] head
- [ ] link artifact

## T6.6 GitHub Callback

原线程：

- [ ] picked up
- [ ] running
- [ ] failed
- [ ] PR created
- [ ] completed

---

# Milestone 7 — Web

## T7.1 Dashboard

**标记：** `[参考 OpenHands]`

展示：

- [ ] Running Tasks
- [ ] Failed Tasks
- [ ] Online Runner
- [ ] Recent PR

## T7.2 Projects

- [ ] Project list
- [ ] Repository binding
- [ ] Runner mapping

## T7.3 Task List

过滤：

- [ ] status
- [ ] project
- [ ] source

## T7.4 Task Detail

**标记：** `[参考 OpenHands] [参考 Orca]`

Tabs / Sections：

- [ ] Overview
- [ ] Timeline
- [ ] Agent Output
- [ ] Logs
- [ ] Changed Files
- [ ] Tests
- [ ] Artifacts

## T7.5 Mobile UX

**标记：** `[参考 Orca]`

要求：

- [ ] iPhone 单手可操作
- [ ] Task 状态优先显示
- [ ] Cancel 按钮可达
- [ ] PR 一键打开
- [ ] Long logs 折叠

---

# Milestone 8 — Governance

## T8.1 Evidence Engine

**标记：** `[参考 OpenTag: governance]`

Fix Task 默认：

```text
git_changes
test_result
commit
pull_request
```

## T8.2 Complete Decision

禁止：

```text
agent says "done"
=> succeeded
```

要求：

```text
required evidence satisfied
=> succeeded
```

## T8.3 Approval Model

第二阶段：

- [ ] shell approval
- [ ] push approval
- [ ] destructive operation approval

---

# Milestone 9 — 稳定性

## T9.1 Runner Disconnect

- [ ] heartbeat timeout
- [ ] run interrupted
- [ ] error 可诊断

## T9.2 Retry

- [ ] failed run retry
- [ ] 新 Run ID
- [ ] 保留上一轮 Event

## T9.3 Idempotency

- [ ] GitHub delivery
- [ ] Task create
- [ ] claim
- [ ] complete

## T9.4 Secret Redaction

> **[OPEN QUESTION — 排期风险]** 脱敏排在 M9 过晚：日志流从 M4（Agent Runtime 的 log event）就经 Server 流向 Web/RunEvent，M4–M8 期间敏感信息可能未过滤就落库，违反"Secret 不写 RunEvent"（architecture.md §14）。建议将脱敏提前到日志通道首次建立时（M4）实现，M9 仅做完善。

过滤：

- [ ] GitHub token
- [ ] Provider API key
- [ ] Bearer token
- [ ] 常见 `.env` secrets

---

# 开发顺序

严格建议：

```text
T0
↓
T1
↓
T2
↓
T3
↓
T4
↓
Web Task → Runner → OpenCode 跑通
↓
T5
↓
修改代码 + Test + Commit 跑通
↓
T6
↓
GitHub → OpenCode → PR 跑通
↓
T7
↓
补 Web UI
↓
T8/T9
```

不要先做漂亮 UI。

---

# MVP Definition of Done

必须完整跑通：

```text
GitHub Issue Comment
    ↓
@agent fix this
    ↓
Control Server
    ↓
Task
    ↓
Windows Runner
    ↓
OpenCode ACP
    ↓
isolated Worktree
    ↓
code changes
    ↓
tests
    ↓
commit
    ↓
push
    ↓
GitHub PR
    ↓
GitHub comment
    ↓
Web Task = succeeded
```

并满足：

- [ ] Windows 不开放 inbound OpenCode 端口
- [ ] Control Server 不保存模型 Key
- [ ] 日志可追踪
- [ ] Run 可取消
- [ ] 失败可诊断
- [ ] 不允许 direct push 默认分支

---

# 明确不做

在 MVP 完成前，禁止主动扩展：

```text
Slack
Feishu
Telegram
Claude Executor
Codex Executor
PI Executor
Herdr
Docker Sandbox
多人协作
收费
复杂 RBAC
自动 Merge
Workflow DSL
```

先把单机 OpenCode GitHub 闭环跑通。
