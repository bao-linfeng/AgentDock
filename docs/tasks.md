# OpenCode Remote — Tasks

## 实现进度与 Issue 对照

> 状态图例：✅ 已完成 · 🟡 部分完成 · ⬜ 待办
>
> GitHub 议题：https://github.com/bao-linfeng/AgentDock/issues

| 里程碑 | 任务 | 状态 | Issue / PR |
| --- | --- | --- | --- |
| M0 技术验证 | T0.1 ACP 冒烟测试 | ⬜ | #16 |
| | T0.2 OMO Slim 兼容性 | ⬜ | #17 |
| | T0.3 OpenTag 源码走读 | ⬜ | #18 |
| M1 Monorepo 与 Protocol | T1.1 初始化 Monorepo | ✅ | 基线提交 |
| | T1.2 Protocol Schema | 🟡 | 基线提交 |
| | T1.3 Run 状态机 | ✅ | 基线提交 |
| M2 Server 基础 | T2.1 NestJS 模块 | ✅ | #19（epic #6） |
| | T2.2 Prisma Schema | ✅ | #20 |
| | T2.3 Project CRUD | ✅ | #21 |
| | T2.4 Runner Gateway 与取消通道 | ✅ | #22 |
| M3 Local Runner | T3.1 Runner 配置安全 | ✅ | #5 / PR #14 |
| | T3.2 注册与心跳 | ✅ | #23（服务端接口 #22；Runner 侧循环见 apps/runner/src/heartbeat-loop.ts） |
| | T3.3 项目映射（根包含校验） | 🟡 | #5（部分）/ #24（服务端映射接口已完成） |
| | T3.4 任务领取核心 | ✅ | #3 / PR #12 |
| | T3.4b Runner 领取→执行主循环 | ✅ | #24 |
| M4 Agent Runtime | T4.1 AgentExecutor 接口 | ✅ | 基线提交 |
| | T4.2 OpenCodeExecutor | ✅ | #25（epic #7） |
| | T4.3 事件桥接 | ✅ | #26 |
| M5 Git Runtime | T5.1 WorktreeManager | ✅ | #1 / PR #10 |
| | T5.2 变更检测 | ✅ | #1 / PR #10 |
| | T5.3 验证（测试命令） | ✅ | #1 / PR #10 |
| | T5.4 提交 / 推送 | ⬜ | #27 |
| M6 GitHub | T6.1 App / Token 接入 | ⬜ | #28 |
| | T6.2 Webhook 验签与去重 | ✅ | #29 / PR #49 |
| | T6.3 事件归一化 | ✅ | #2 / PR #11 |
| | T6.4 Mention 触发 | ✅ | #2 / PR #11 |
| | T6.5 创建 PR | ⬜ | #30 |
| | T6.6 回调评论 | ⬜ | #31 |
| M7 Web | T7.1 Dashboard | ✅ | #32（epic #8） |
| | T7.2 Projects | 🟡 | #33（仓库绑定待 GitHub App 接入 #28 合并后开放；Webhook 验签/去重 #29 已完成） |
| | T7.3 Task List | ✅ | #34 |
| | T7.4 Task Detail | ✅ | #35 |
| | T7.5 Mobile UX | ✅ | #36 |
| M8 Governance | T8.1 证据引擎 | ✅ | #4 / PR #13 |
| | T8.2 完成判定 | ✅ | #4 / PR #13 |
| | T8.3 审批模型 | ⬜ | #37 |
| M9 稳定性 | T9.1 Runner 断连 | ✅ | #38（epic #9） |
| | T9.2 重试 | ✅ | #39 |
| | T9.3 幂等 | ✅ | #40 |
| | T9.4 密钥脱敏 | ✅ | #5 / PR #14 |

> 说明：#6/#7/#8/#9 为里程碑级 epic，#16–#40 为拆细的具体任务，二者以"属于 #N"关联。
> "明确不做"清单中的能力（见文末）不建 issue。

---

## Milestone 0 — 技术验证

目标：先证明 OpenCode ACP 路径可行。

### T0.1 OpenCode ACP Smoke Test

**类型：** Spike  
**优先级：** P0  
**标记：** `[参考 OpenTag] [可直接复用优先]`

> ⬜ 待办（#16）

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

> ⬜ 待办（#17）

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

> ⬜ 待办（#18）

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

> ✅ 已完成（基线提交）

- [x] pnpm workspace
- [x] apps/web
- [x] apps/server
- [x] apps/runner
- [x] packages/protocol
- [x] packages/agent-runtime
- [x] packages/github-adapter
- [x] packages/task-engine
- [x] packages/shared

## T1.2 Protocol Schema

**标记：** `[参考 OpenTag: core]`

> 🟡 部分完成（基线提交；`CallbackRoute` 与 JSON Schema 导出待补）

实现 Zod Schema：

- [x] AgentTask
- [x] AgentRun
- [x] RunEvent
- [x] RunArtifact
- [x] ContextPointer
- [x] PermissionGrant
- [ ] CallbackRoute

要求：

- [x] TypeScript 类型从 Schema 推导
- [ ] 可导出 JSON Schema
- [x] Server / Runner 共用

## T1.3 Run Status State Machine

> ✅ 已完成（基线提交，`packages/protocol/src/status.ts`）

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

- [x] 非法状态跳转测试
- [x] terminal state 不可继续运行

---

# Milestone 2 — Server 基础

## T2.1 NestJS Server

> ✅ 已完成（#19 / epic #6，`apps/server/src`）
>
> **[已决策]** MVP 采用两个独立静态 token（`API_AUTH_TOKEN` 用于 Web，`RUNNER_TOKEN`
> 用于 Runner），**不做 users 表、不做登录流程 / JWT**。AuthModule 因此只是两个
> Guard；Runner token 以 `runners.token_hash` 落库，可单独撤销。

模块：

- [x] AuthModule（静态 token 双通道 Guard）
- [x] ProjectsModule
- [x] TasksModule
- [x] RunsModule
- [x] RunnersModule
- [x] GitHubModule（`GET /github/status` + `POST /github/webhook`，验签与去重见 #29）
- [x] EventsModule（SSE：先回放 DB 事件，再推送实时事件）

## T2.2 Prisma Schema

> ✅ 已完成（#20，`apps/server/prisma/schema.prisma` + 迁移 `20260829012328_init`）

表：

- [x] projects
- [x] repositories
- [x] runners（`token_hash` / `revoked` / `revoked_at`）
- [x] runner_projects
- [x] tasks（去重键：`source_ref` 与 `delivery_id` 唯一索引）
- [x] task_runs（新增 `cancel_requested_at` 取消通道 + `created_at` / `updated_at`）
- [x] run_events（`(run_id, seq)` 唯一）
- [x] artifacts
- [x] approvals
- [x] users —— 明确不做（静态 token 决定）

## T2.3 Project CRUD

> ✅ 已完成（#21；Runner Gateway 与取消通道见 T2.4 / #22）

- [x] 创建项目
- [x] 修改项目
- [x] 删除项目（存在进行中的 Run 时拒绝，409）
- [x] 配 default branch
- [x] 配 test command
- [x] 配 build command

## T2.4 Runner Gateway 与取消通道

> ✅ 已完成（#22，`apps/server/src/runner-gateway`）

- [x] `POST /runner/register`（只存 token 哈希）
- [x] `GET /runner/tasks/claim`（条件 UPDATE 原子领取，单 Runner 单任务）
- [x] `POST /runner/runs/:id/events`（status 事件驱动状态机，payload 落库前脱敏）
- [x] `POST /runner/runs/:id/heartbeat` → 返回 `cancelRequested`
- [x] `POST /runner/runs/:id/complete`（终态 + artifacts）
- [x] `POST /runner/heartbeat`（空闲心跳）
- [x] 只允许领取"已映射且启用"的项目（architecture §14）

---

# Milestone 3 — Local Runner

## T3.1 Runner 配置

> ✅ 已完成（#5 / PR #14，`apps/runner/src/config.ts`）

本地配置：

```json
{
  "serverUrl": "...",
  "runnerToken": "...",
  "runnerName": "...",
  "projects": {}
}
```

- [x] 不存模型 API Key
- [x] token 文件权限检查

## T3.2 Runner 注册

> ✅ 已完成（#23，`apps/runner/src/runner-client.ts` + `heartbeat-loop.ts`）
>
> `RunnerClient` 封装 `POST /runner/register` 与 `POST /runner/heartbeat`（均带
> `Authorization: Bearer <runnerToken>`，10s 请求超时）；`register` 上报
> `platform`（默认取 `node:os` 的 `platform()`）与可选的 `machineName`/`version`。
> `HeartbeatLoop` 在启动时注册一次，随后按 `DEFAULT_HEARTBEAT_INTERVAL_MS`
> （15s）轮询 `POST /runner/heartbeat`；心跳成功/失败驱动本地
> online/offline 状态回调（纯用于日志可见性，服务端的权威判定仍是
> `RUNNER_OFFLINE_TIMEOUT_MS` + `RunnerDisconnectSweeper`，见 #38）。
> Token 被服务端吊销（401 + "revoked"）时，循环自动停止并给出明确的错误提示。
> `apps/runner/src/index.ts` 中完整接入，含 SIGINT/SIGTERM 优雅关闭。

- [x] register（服务端 + Runner 侧）
- [x] heartbeat（服务端 + Runner 侧）
- [x] online/offline
- [x] version
- [x] platform

## T3.3 Runner Project Mapping

> 🟡 部分完成（根包含校验已在 #5 完成；服务端映射接口 `PUT /runners/:id/projects/:projectId` 已在 #22 完成；Runner 侧路径解析见 #24）

```text
server project id
→
local workspace path
```

- [x] 路径存在检查
- [x] Git Repo 检查
- [x] root containment
- [x] 服务端映射存储（`runner_projects.workspace_path`，未映射的项目不可领取）

## T3.4 Task Claim

**标记：** `[参考 OpenTag: dispatcher]`

> ✅ 领取核心已完成（#3 / PR #12，`packages/task-engine`；服务端 DB 版原子领取见 #22）；Runner 侧主循环见 #24（已完成）

- [x] Runner 主动 claim（见 T3.4b / #24）
- [x] 单 Runner MVP
- [x] 每次只执行一个任务（服务端在 claim 时强制）
- [x] claim 后原子更新 assigned（引擎 + 服务端条件 UPDATE 均已实现）

## T3.4b Runner 领取→执行主循环

> ✅ 已完成（#24，`apps/runner/src/claim-execute-loop.ts`）
>
> `ClaimExecuteLoop` 按固定间隔（`CLAIM_POLL_INTERVAL_MS`，5s）轮询
> `GET /runner/tasks/claim`；领取到任务后依次执行：
> `running` → `WorktreeManager.create`（git-runtime，#1）→ `AgentExecutor.run`
> （agent-runtime `OpenCodeExecutor`，#7）→ `verifying`（变更检测 +
> 可选测试命令 `runVerification`）→ `publishing`（`WorktreeManager.commit`
> 本地提交）→ 用 `@agentdock/governance` 的 `decideCompletion` 按证据规则
> 判定终态 → `POST /runner/runs/:id/complete`。
>
> 取消：后台 `runHeartbeat`（`RUN_HEARTBEAT_INTERVAL_MS`，10s）持续轮询
> `POST /runner/runs/:id/heartbeat` 的 `cancelRequested`；主流程在关键阶段之间
> 检查该标志，一旦发现取消请求，会调用 `executor.cancel()` 并以 `cancelled`
> 终态收尾，而不是直接杀进程。
>
> **[范围边界]** 本任务只做本地 `git commit`（满足 governance 的 `commit`
> 证据），**不做** `git push` 与 PR 创建——这两项仍是 #27（T5.4，已实现，见
> PR #47）与 #30（T6.5）的范围。GitHub App/Token 接入（#28）已实现（见
> PR #48），webhook 验签与去重（#29）已完成；上述 PR 合并后 `fix`/`implement`
> 任务的推送与 PR 创建能力即可打通。当前若最终没有额外产出 `pull_request`
> artifact，`decideCompletion` 会按证据规则判定为 `failed`
> （`errorCode: 'evidence_incomplete'`），这是预期行为，等 #27/#30 落地后
> 会自然满足。`apps/runner/src/index.ts` 中已将该循环与心跳循环并行启动。

---

# Milestone 4 — Agent Runtime

## T4.1 AgentExecutor Interface

**标记：** `[参考 OpenTag: runner]`

> ✅ 已完成（基线提交，`packages/agent-runtime/src/index.ts`）

实现：

```ts
canRun()
run()
cancel()
```

## T4.2 OpenCodeExecutor

> ✅ 已完成（#25，`packages/agent-runtime/src/index.ts` + `acp-client.ts`）
>
> 使用官方 `@agentclientprotocol/sdk`（TypeScript ACP SDK）实现，`launchAcpProcess`
> 通过 `opencode acp` 子进程 + `ndJsonStream` 建立连接；`OpenCodeExecutor.run` 走
> `initialize` → `session/new`（绑定 `workspaceCwd`）→ `session/prompt` 流程。
> `launch` 选项作为测试替身注入点，单测通过内存 `TransformStream` 对接真实
> `acp.agent()` 驱动协议，未依赖 TUI stdout。
>
> **[遗留风险]** T0.1（#16，ACP 冒烟测试）仍未作为独立 Spike 完成 ——
> 本任务的单元测试覆盖了协议交互逻辑，但尚未用真实 `opencode acp` 二进制人工验证
> 端到端连通性。建议在接入真实 Runner 主循环（#24）前补跑一次真实冒烟测试。

- [x] ACP launcher
- [x] cwd
- [x] prompt
- [x] context
- [x] progress
- [x] cancellation
- [x] structured final result
- [x] timeout

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

> ✅ 已完成（#26，`bridgeSessionUpdate` in `packages/agent-runtime/src/index.ts`）
>
> `ExecutorEventSink` 新增 `error(message, code?)` 方法（原接口缺失，本任务按
> 验收要求补上）。`agent_message_chunk` / `tool_call` / `tool_call_update` 桥接为
> `log`；失败的 `tool_call_update` 额外触发 `error`；所有文本内容经
> `redactSecrets` 脱敏（含子进程 stderr）。`verification` / `artifact` 桥接留给
> Runner 主循环（#24）在收到 executor 最终结果后调用测试命令与产物收集，
> Executor 本身不产出这两类事件。

- [x] status
- [x] log
- [x] artifact（由调用方在 `ExecutorRunResult.artifacts` 基础上产出；executor 不直接推送）
- [x] verification（同上，属于 Runner 主循环职责，接口已就位）
- [x] error

---

# Milestone 5 — Git Runtime

## T5.1 WorktreeManager

> ✅ 已完成（#1 / PR #10，`packages/git-runtime`）

- [x] fetch
- [x] create branch
- [x] add worktree
- [x] validate clean base
- [x] cleanup

## T5.2 Git Change Detection

> ✅ 已完成（#1 / PR #10）

- [x] changed files
- [x] diff stats
- [x] no-change detection

## T5.3 Verification

> ✅ 已完成（#1 / PR #10，`runVerification`）

- [x] run configured test command
- [x] collect exit code
- [x] collect bounded output
- [x] create VerificationResult

## T5.4 Commit / Push

> 🟡 部分完成（#27）
>
> `WorktreeManager.commit()` 已随 #24 落地（`packages/git-runtime/src/index.ts`）：
> 对 worktree 内的变更 `git add -A` + `git commit`，返回新提交的 SHA，供 Runner
> 主循环产出 `commit` RunArtifact。**推送到 origin 与创建 PR 仍待办**——
> 需要 #28（GitHub App/Token 接入）提供推送目标后才能实现。

- [x] commit（本地提交，`WorktreeManager.commit`；#24）
- [ ] configurable commit template（Runner 侧已支持 `commitMessageTemplate` 选项，默认模板见 #24；项目级可配置模板仍待办）
- [ ] push new branch
- [ ] 禁止 direct push default branch

---

# Milestone 6 — GitHub

## T6.1 GitHub App / Token 接入

> ⬜ 待办（#28）

- [ ] Webhook secret
- [ ] Installation auth
- [ ] Repository binding

## T6.2 Webhook Verification

> ✅ 已完成（#29，`apps/server/src/github/{webhook-signature,webhook,webhook.dto}.ts`）

- [x] signature verify — HMAC-SHA256 over the raw body, `X-Hub-Signature-256`,
      constant-time compare (`node:crypto.timingSafeEqual`)
- [x] dedupe delivery id — `X-GitHub-Delivery` checked against `tasks.deliveryId`
      before parsing the payload, plus `TasksService.create`'s own
      `sourceRef`/`deliveryId` unique-constraint dedupe as a second line of
      defense against a race between concurrent deliveries
- [x] `POST /github/webhook` wired in `GitHubController` (public — no
      `ApiTokenGuard`, since GitHub cannot send our API token)
- [x] repo → project resolution via the `repositories` table (unblocks once
      #28 lands rows there); unbound repos are ignored, not errored
- [x] actor allowlist enforcement via `GITHUB_ACTOR_ALLOWLIST` (requirements.md
      §6.2)

## T6.3 Event Normalizer

**标记：** `[参考 OpenTag: github]`

> ✅ 已完成（#2 / PR #11，`packages/github-adapter`）

支持：

- [x] issue
- [x] issue_comment
- [x] pull_request
- [x] review_comment

统一输出：

```text
AgentTaskCreateInput
```

## T6.4 Mention Trigger

> ✅ 已完成（#2 / PR #11）

默认：

```text
@agent
```

- [x] allowlist
- [x] ignore bot self-callback
- [x] strip mention from prompt

## T6.5 Pull Request Creation

> ⬜ 待办（#30）

- [ ] title
- [ ] body
- [ ] base
- [ ] head
- [ ] link artifact

## T6.6 GitHub Callback

> ⬜ 待办（#31）

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

> ✅ 已完成（#32，epic #8，`apps/web/src/views/DashboardView.vue`）

展示：

- [x] Running Tasks
- [x] Failed Tasks
- [x] Online Runner
- [x] Recent PR（通过最近 `succeeded` 任务的最新 Run 产物中筛选 `type: 'pull_request'`）

## T7.2 Projects

> 🟡 部分完成（#33，`apps/web/src/views/ProjectsView.vue`）

- [x] Project list（创建 / 编辑 / 删除）
- [ ] Repository binding —— Control Server 尚未提供 `/repositories` 端点（依赖 GitHub App 接入，见 #28/#29），前端页面已预留入口并明确标注"尚未开放"，避免伪造 API
- [x] Runner mapping（`PUT/DELETE /runners/:id/projects/:projectId`）

## T7.3 Task List

> ✅ 已完成（#34，`apps/web/src/views/TasksView.vue`）

过滤：

- [x] status
- [x] project
- [x] source

## T7.4 Task Detail

**标记：** `[参考 OpenHands] [参考 Orca]`

> ✅ 已完成（#35，`apps/web/src/views/TaskDetailView.vue`）

Tabs / Sections：

- [x] Overview
- [x] Timeline（`RunTimeline.vue`，基于 `status` / `error` 类型的 RunEvent）
- [x] Agent Output（`log` / `tool` 类型 RunEvent）
- [x] Logs（`LogViewer.vue`，长日志可折叠）
- [x] Changed Files（`diff` 类型 Artifact）
- [x] Tests（`test_result` 类型 Artifact）
- [x] Artifacts（其余 Artifact，含 `pull_request`）

取消（`POST /tasks/:id/cancel`）与打开 PR（`pull_request` artifact 的 `uri`）已实现；
实时更新通过 `GET /events/runs/:id` SSE（`useRunEvents.ts`，`?access_token=` 鉴权 +
`afterSeq` 断线重连），已用真实 Control Server + MySQL 做端到端联调验证。

## T7.5 Mobile UX

**标记：** `[参考 Orca]`

> ✅ 已完成（#36，贯穿各页面的响应式样式，`apps/web/src/styles/main.css` + `AppShell.vue`）

要求：

- [x] iPhone 单手可操作（底部 Tab 导航、44px 最小触控目标）
- [x] Task 状态优先显示（详情页顶部 sticky 状态卡片）
- [x] Cancel 按钮可达（详情页顶部操作区）
- [x] PR 一键打开（详情页顶部 + Artifacts 分区）
- [x] Long logs 折叠（`LogViewer.vue`，超过 12 行默认折叠）

---

# Milestone 8 — Governance

## T8.1 Evidence Engine

**标记：** `[参考 OpenTag: governance]`

> ✅ 已完成（#4 / PR #13，`packages/governance`；证据规则可按项目配置）

Fix Task 默认：

```text
git_changes
test_result
commit
pull_request
```

## T8.2 Complete Decision

> ✅ 已完成（#4 / PR #13，`decideCompletion`）

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

> ⬜ 待办（#37）

第二阶段：

- [ ] shell approval
- [ ] push approval
- [ ] destructive operation approval

---

# Milestone 9 — 稳定性

## T9.1 Runner Disconnect

> ✅ 已完成（#38，`apps/server/src/runners/runner-disconnect.sweeper.ts`）
>
> `RunnerDisconnectSweeper` 通过 `@nestjs/schedule` 的 `@Interval` 每
> `RUNNER_DISCONNECT_SWEEP_INTERVAL_MS`（15s）扫描一次仍标记为 `online` 但心跳已超过
> `RUNNER_OFFLINE_TIMEOUT_MS`（45s）的 Runner：将其名下处于 in-flight 状态
> （`assigned`/`running`/`needs_approval`/`verifying`/`publishing`）的 Run 通过
> `RunsService.failDisconnected` 标记为 `failed`（`errorCode: 'runner_disconnected'`），
> 再把 Runner 本身标记为 `offline`。

- [x] heartbeat timeout
- [x] run interrupted
- [x] error 可诊断

## T9.2 Retry

> ✅ 已完成（#39，`RunsService.retry`）
>
> 仅允许对 `failed` 状态的 Run 重试，且同一 Task 下不能有其他仍处于活动状态的 Run；
> 重试会创建一个新的 `TaskRun`（新 id，`queued`），原失败 Run 与其事件历史保持不变。
> 新增 `POST /runs/:id/retry` 端点。

- [x] failed run retry
- [x] 新 Run ID
- [x] 保留上一轮 Event

## T9.3 Idempotency

> ✅ 已完成（#40：Task 去重键与 claim/complete 幂等已随 #22 落地）

- [x] GitHub delivery（`tasks.delivery_id` 唯一索引，重复投递返回既有 Task）
- [x] Task create（`source_ref` 唯一索引 + `deduplicated` 标记）
- [x] claim（条件 UPDATE，不会重复领取）
- [x] complete（终态 Run 再次 complete 返回 409）
- [ ] Webhook 层去重（需 #29 的验签与投递记录；webhook 路由本身随 #29 才落地，暂不在
  #40 范围内）

## T9.4 Secret Redaction

> ✅ 已完成（#5 / PR #14，`packages/shared/src/redact.ts`；脱敏已提前到 M4 日志通道可用）

> **[OPEN QUESTION — 排期风险]** 脱敏排在 M9 过晚：日志流从 M4（Agent Runtime 的 log event）就经 Server 流向 Web/RunEvent，M4–M8 期间敏感信息可能未过滤就落库，违反"Secret 不写 RunEvent"（architecture.md §14）。建议将脱敏提前到日志通道首次建立时（M4）实现，M9 仅做完善。

过滤：

- [x] GitHub token
- [x] Provider API key
- [x] Bearer token
- [x] 常见 `.env` secrets

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
