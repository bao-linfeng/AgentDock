# OpenCode Remote — Tasks

## 实现进度与 Issue 对照

> 状态图例：✅ 已完成 · 🟡 部分完成 · ⬜ 待办
>
> GitHub 议题：https://github.com/bao-linfeng/AgentDock/issues

| 里程碑 | 任务 | 状态 | Issue / PR |
| --- | --- | --- | --- |
| M0 技术验证 | T0.1 ACP 冒烟测试 | ✅ | #16 |
| | T0.2 OMO Slim 兼容性 | ✅ | #17 |
| | T0.3 OpenTag 源码走读 | ✅ | #18 |
| M1 Monorepo 与 Protocol | T1.1 初始化 Monorepo | ✅ | 基线提交 |
| | T1.2 Protocol Schema | ✅ | 基线提交 / #62 |
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
| | T5.4 提交 / 推送 | ✅ | #27 |
| M6 GitHub | T6.1 App / Token 接入 | ✅ | #28 |
| | T6.2 Webhook 验签与去重 | ✅ | #29 / PR #49 |
| | T6.3 事件归一化 | ✅ | #2 / PR #11 |
| | T6.4 Mention 触发 | ✅ | #2 / PR #11 |
| | T6.5 创建 PR | ✅ | #30（多绑定仓库 PR 目标选择 follow-up 见 #51） |
| | T6.6 回调评论 | ✅ | #31 |
| M7 Web | T7.1 Dashboard | ✅ | #32（epic #8） |
| | T7.2 Projects | ✅ | #33（仓库绑定已随 #28 打通；Webhook 验签/去重 #29 已完成；已迁移为 Tailwind + shadcn-vue） |
| | T7.3 Task List | ✅ | #34 |
| | T7.4 Task Detail | ✅ | #35 |
| | T7.5 Mobile UX | ✅ | #36 |
| | T7.6 新建任务表单（Web 派发） | ✅ | #59 |
| | T7.7 失败重试入口与 errorCode 展示 | ✅ | #61 |
| M8 Governance | T8.1 证据引擎 | ✅ | #4 / PR #13 |
| | T8.2 完成判定 | ✅ | #4 / PR #13 |
| | T8.3 审批模型 | ✅ | #37 |
| | T8.4 证据规则按项目配置 | ✅ | #60 |
| M9 稳定性 | T9.1 Runner 断连 | ✅ | #38（epic #9） |
| | T9.2 重试 | ✅ | #39 |
| | T9.3 幂等 | ✅ | #40 |
| | T9.4 密钥脱敏 | ✅ | #5 / PR #14 |
| | T9.5 统一 Audit Log | ✅ | #63 |
| MVP DoD | 端到端验证清单与记录 | ✅ | #64 |

> 说明：#6/#7/#8/#9 为里程碑级 epic，#16–#40 为拆细的具体任务，二者以"属于 #N"关联。
> "明确不做"清单中的能力（见文末）不建 issue。

---

## Milestone 0 — 技术验证

目标：先证明 OpenCode ACP 路径可行。

### T0.1 OpenCode ACP Smoke Test

**类型：** Spike  
**优先级：** P0  
**标记：** `[参考 OpenTag] [可直接复用优先]`

> ✅ 已完成（#16）——`packages/agent-runtime/src/smoke/opencode-acp-smoke.ts`
> （运行：`pnpm --filter @agentdock/agent-runtime run smoke:acp`，需要本机已安装
> `opencode` 并完成 `opencode providers login`）。全部验收项已用真实
> `opencode acp` 二进制验证通过；过程中发现并修复了 Windows 下
> `launchAcpProcess` 因 `.cmd` shim 导致 `spawn` 报 `ENOENT`/`EINVAL` 的问题
> （`acp-client.ts` 现在在 `win32` 上使用 `shell: true`，见 `acp-client.test.ts`）。

验收：

- [x] Node 可启动 OpenCode ACP
- [x] 指定 `workspaceCwd`
- [x] 提交一个简单 Prompt
- [x] 能收到结构化 Progress
- [x] 能收到 Final Result
- [x] 能取消 Run
- [x] 不依赖 TUI stdout parser

### T0.2 OMO Slim 兼容性验证

**优先级：** P0

> ✅ 已完成（#17）——`packages/agent-runtime/src/smoke/omo-slim-acp-smoke.ts`
> （运行：`pnpm --filter @agentdock/agent-runtime run smoke:omo-slim`，需要本机
> 已安装 `opencode` 并完成 `opencode providers login`，且能联网拉取
> `oh-my-opencode-slim@latest` 插件）。验证在隔离环境（`XDG_CONFIG_HOME`
> 指向临时空目录，仅由项目本地 `opencode.json` 的 `plugin` 字段启用 OMO
> Slim）下进行，结果不依赖任何开发者机器上已有的全局配置。详细过程与结论见
> [`docs/research/omo-slim-acp-compat-notes.md`](./research/omo-slim-acp-compat-notes.md)。

验证：

- [x] pure mode（即纯 ACP 协议通道，不依赖 TUI stdout parser）下插件是否加载
- [x] orchestrator 是否正常
- [x] designer / fixer / explorer 委派是否正常（以 explorer 为例验证通过）
- [x] 是否污染 ACP stdout（未污染，ndjson 解析全程无错误）
- [x] cancel 是否正常
- [x] cwd 是否始终位于 Worktree

结论输出：

```text
compatible_with_limitations
```

两点已知限制（不阻塞 MVP，已记录为后续待办）：

1. `OpenCodeExecutorOptions` 目前没有一等的开关来强制 `opencode acp --pure`
   （禁用外部插件）；只能通过某个项目自身的 `opencode.json` 移除插件配置来
   规避不兼容的插件。
2. OMO Slim 内部专职 agent 命名（`explorer / oracle / council / librarian /
   designer / fixer` + `orchestrator`）与 `docs/architecture.md` §12 图示的
   简化命名不完全一致（该文档已有 TODO 标注此差异）；Control Server 必须继续
   不依赖这些内部名称——已确认委派在 ACP 事件流中始终表现为通用的
   `tool_call`/`tool_call_update`，调用方无需感知具体子 agent 名称。

### T0.3 OpenTag Runner Code Reading

**标记：** `[参考 OpenTag]`

> ✅ 已完成（#18），产出见 [`docs/research/opentag-runner-notes.md`](./research/opentag-runner-notes.md)

已直接阅读 `@opentag/runner` 包源码（commit `491dd79f`，tag `v0.11.0`），确认
`createAcpAgentExecutor` / `createBuiltInAcpExecutors` / built-in ACP agent
definitions 均为真实存在的导出 API 名（此前的假设与源码一致）。

重点定位：

- [x] built-in ACP agent definitions（`builtin-acp.ts`：codex / claude-code / cursor / opencode / hermes / openclaw 六个）
- [x] createAcpAgentExecutor（`acp-agent.ts`）
- [x] createBuiltInAcpExecutors（`builtin-acp.ts`）
- [x] workspace cwd conformance（`acp-executor.ts` 的 `safeAcpCwd` + worktree 隔离，capability 声明为 `"declared"`）
- [x] progress（`ExecutorEventSink` + `progressEvents: "audit"`，ACP `session/update` → `executor.progress` 事件）
- [x] cancellation（ACP 协议级 `session/cancel` notify + 操作系统级进程组强制终止兜底，`openclaw` 的 `supportsCancel: false` 体现"best effort"）
- [x] readiness（`canRun()`：git 仓库/分支检查 → cwd 校验 → 自定义 preflight → 一次性 ACP `initialize` 握手探测）

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

> ✅ 已完成（基线提交 + #62：`CallbackRoute` 与 JSON Schema 导出）

实现 Zod Schema：

- [x] AgentTask
- [x] AgentRun
- [x] RunEvent
- [x] RunArtifact
- [x] ContextPointer
- [x] PermissionGrant
- [x] CallbackRoute（#62，`CallbackRouteSchema` + `callbackRouteFrom`）

要求：

- [x] TypeScript 类型从 Schema 推导
- [x] 可导出 JSON Schema（#62，`packages/protocol/src/json-schema.ts`：
      `PROTOCOL_SCHEMAS` / `toJsonSchema(name)` / `exportJsonSchemas()`，
      基于 `zod-to-json-schema@3.24.5`）
- [x] Server / Runner 共用

> **#62 说明**：回帖目标此前以 `Task.callbackRepo` / `callbackIssueNumber` /
> `callbackIsPullRequest` 三个裸字段散落在 Prisma 与 server 代码里（#31 引入），
> 协议层没有统一表达。现在 `CallbackRouteSchema`（`provider` / `repo` /
> `issueNumber` / `isPullRequest`）是协议级表示：
> `packages/github-adapter` 的 `toCallbackRoute()` 从归一化结果产出它，
> `apps/server/src/github/run-callback.service.ts` 用 `callbackRouteFrom(task)`
> 消费它（存储仍是扁平列，非法值返回 `null` 而不是抛错）。JSON Schema 导出让
> 协议可以被 TypeScript 之外的工具消费，Zod 仍是唯一事实来源。

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
- [x] GitHubModule（`GET /github/status`、`GET /github/installations`、
  `POST /github/webhook`、`repositories` CRUD；验签/去重见 #29，App 鉴权/仓库绑定见 #28）
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
> 证据）与（若项目启用）`git push`；PR 创建不在本任务范围内，而是 Control
> Server 侧在收到 `complete` 上报后按需自动补齐（见 #30 / T6.5）。`git push`
> （推送 agent 分支到已配置的 remote，禁止直推默认/受保护分支）已由 #27
> （T5.4，PR #47）补齐，GitHub App/Token 接入（#28，PR #48）、webhook 验签/
> 去重（#29，PR #49）与 PR 创建（#30，T6.5）均已完成。因此对 `fix`/
> `implement` 意图的任务，Runner 上报的初次判定即使因缺 `pull_request` 证据
> 报告为 `failed`（`errorCode: 'evidence_incomplete'`），只要该 run 已经有一条
> `metadata.pushed: true` 的 `commit` artifact，Control Server 的
> `RunsService.complete` 就会在写入终态前自动尝试开 PR、补上
> `pull_request` artifact 并重新判定——最终对外呈现的状态可能是
> `succeeded`，与 Runner 本地判定不完全一致，这是预期行为（见 T6.5 的设计
> 取舍说明）。`apps/runner/src/index.ts` 中已将该循环与心跳循环并行启动。

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

> ✅ 已完成（#27）
>
> `WorktreeManager.commit()` 已随 #24 落地（`packages/git-runtime/src/index.ts`）：
> 对 worktree 内的变更 `git add -A` + `git commit`，返回新提交的 SHA，供 Runner
> 主循环产出 `commit` RunArtifact。**推送到 origin** 由本任务（#27）新增的
> `WorktreeManager.push()` 完成：复用项目本地已配置好的 git remote/凭据（与人工
> `git push` 一致），**不**依赖 #28（GitHub App/Token）——那是给 Control
> Server 侧调 GitHub API（开 PR、回帖）用的凭证，跟本机 `git push` 是两套体系。
> `push()` 默认会拒绝直推 base/受保护分支，只推 agent 分支本身；没有配置远程时
> 返回 `pushed: false` 而不是抛错，离线/纯本地仓库可以优雅降级。是否启用推送、
> 推到哪个 remote、额外的受保护分支列表，由 `runner.config.json` 里每个项目的
> `push` 字段（`enabled` / `remote` / `protectedBranches`）控制，默认
> `enabled: false` 保持之前的仅提交行为。Runner 主循环
> （`apps/runner/src/claim-execute-loop.ts`）在 commit 成功后，若该项目启用了
> push，会调用 `push()` 并把结果记录为一条 `commit` 类型的 RunArtifact
> （`metadata.pushed: true` + `remote`/`branch`），Control Server 在收到
> `complete` 上报时用这个标记判断是否可以自动开 PR 补齐 `pull_request` 证据
> （#30，见 T6.5）；push 失败/跳过只记日志，不会让
> run 失败（若没有 push 或 push 失败，证据规则仍会因缺 `pull_request` 而判定
> `fix`/`implement` 为 `failed`，这是预期行为）。

- [x] commit（本地提交，`WorktreeManager.commit`；#24）
- [x] configurable commit template（Runner 侧 `commitMessageTemplate` 选项；#24）
- [x] push new branch（`WorktreeManager.push()`；Runner 侧按项目 `push.enabled` 开关；#27）
- [x] 禁止 direct push default branch（`push()` 默认拒绝推送 `baseBranch` / `protectedBranches`；#27）

---

# Milestone 6 — GitHub

## T6.1 GitHub App / Token 接入

> ✅ 已完成（#28）
>
> `apps/server/src/github/github-app.service.ts` 用官方 `octokit`
> 包（内含 `@octokit/auth-app`）封装 GitHub App 认证：`appOctokit()` 提供
> App 级（JWT）客户端，`installationOctokit(installationId)` 按需签发并缓存
> Installation Token（由 `@octokit/auth-app` 自动刷新），供 #30/#31 调用
> GitHub API（开 PR、回帖）时复用，本任务本身不发起除"校验可访问仓库"外的
> 业务请求。`GITHUB_WEBHOOK_SECRET` 的读取/校验逻辑已随 Control Server 配置
> 模块（`apps/server/src/config/env.ts`）落地，供 #29 在验签时使用（本任务
> 只负责让该配置项可用，签名校验本身仍是 #29 的范围）。
>
> **Repository binding：** `RepositoriesController`（`POST/GET/DELETE
> /projects/:projectId/repositories`）把 GitHub 仓库（`owner`/`repo`）与本地
> `Project` 关联，写入既有的 `repositories` 表（architecture §7）。绑定前会
> 用给定的 `installationId` 实际调用 GitHub API 校验该 Installation 确实能访问
> 目标仓库，避免记错 `installationId` 导致后续 PR/评论调用全部失败才被发现。
> `GET /github/installations` 列出已安装该 App 的 Installation，供 Web 端
> 选择。Web 侧 `RepositoryBindingPanel.vue`（issue #33 的一部分）据此渲染
> 绑定表单，替换掉之前"尚未开放"的占位提示。

- [x] Webhook secret（配置读取/校验已随 Control Server env 落地；签名验证本身仍是 #29）
- [x] Installation auth（`GitHubAppService`，基于官方 `octokit` 包）
- [x] Repository binding（`RepositoriesController` + Web `RepositoryBindingPanel.vue`）

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

> ✅ 已完成（#30，`apps/server/src/github/pull-request.service.ts` +
> `github-app.service.ts` 的 `createPullRequest`；接入点见
> `apps/server/src/runs/runs.service.ts` 的 `RunsService.complete`）
>
> **[设计取舍]** PR 创建放在 **Control Server** 侧，而不是 Runner 侧：Runner
> 主循环（`apps/runner/src/claim-execute-loop.ts`，#24）在 commit/push 完成后
> 会用 `@agentdock/governance` 的 `decideCompletion` 本地判定证据是否齐全——
> 但 Runner 不持有、也不应该持有 GitHub App 凭据（那是 Control Server 的凭据，
> 见 requirements.md 原则 1："云端不直接启动 OpenCode / 本地凭据留在本机"的
> 镜像约束：GitHub 写权限反过来只能留在云端）。因此当 Runner 上报
> `complete({ status: 'failed', errorCode: 'evidence_incomplete' })`，且已有
> 一条 `metadata.pushed: true` 的 `commit` artifact 时，`RunsService.complete`
> 会先尝试通过 `PullRequestService`（内部调用
> `GitHubAppService.createPullRequest`，Octokit `pulls.create`）开 PR
> （`base` = 项目的 `defaultBranch`，`head` = 已推送的分支），成功后补一条
> `pull_request` artifact，再用 `decideCompletion` 重新判定——评估通过则把
> 最终状态由 `failed` 改写为 `succeeded`。
>
> 仅当能明确解析出该 run 对应的目标仓库、且该仓库记录了 `installationId`
> 时才会尝试开 PR；目标仓库的解析规则见 `resolveTargetRepository`
> （`apps/server/src/github/repository-resolver.ts`，#51 follow-up）：若任务
> 携带来源仓库 `callbackRepo`（`owner/repo`，仅 `source: 'github'` 的任务有
> 值），优先匹配该仓库——即使项目绑定了多个仓库也能明确解析；否则（典型为
> `source: 'web'` 的任务）退回到"项目恰好绑定一个仓库"的旧规则。解析失败
> （无法匹配、零个绑定仓库、或恰好一个规则下有多个绑定仓库）、App 未配置、
> 或 GitHub API 调用失败，都是静默跳过（记 warning 日志，run 保持原本的
> `failed`），不会让 run 本身报错。对同一分支重复 `complete`
> （如 retry）会先查已存在的 open PR 并直接复用，保持调用幂等。
>
> PR 正文包含 `taskId`/`runId` 与截断后的原始 prompt，便于人工追溯来源；标题
> 取 prompt 首行。

- [x] title（取 prompt 首行）
- [x] body（关联 taskId/runId + prompt）
- [x] base（项目 `defaultBranch`）
- [x] head（已推送的 agent 分支）
- [x] link artifact（`pull_request` RunArtifact，含 PR number/url，供 #4 证据引擎与 Web `ArtifactsPanel` 消费）

### T6.5 follow-up：多绑定仓库项目的 PR 目标选择（#51）

> ✅ 已完成（#51，`apps/server/src/github/repository-resolver.ts`）
>
> 修复 #51 报告的问题：项目绑定 0 个或 2 个以上仓库时，原实现直接放弃，
> `fix`/`implement` 类 Run 会永远卡在 `failed(evidence_incomplete)`。现在
> `resolveTargetRepository` 优先用任务的 `callbackRepo`（GitHub webhook 触发
> 时归一化写入的来源仓库）在项目绑定的仓库列表中精确匹配，解决多仓库场景下
> 的歧义；`source: 'web'` 等没有 `callbackRepo` 的任务，仍要求项目恰好绑定一
> 个仓库。该解析函数同时被 `PullRequestService.openForRun` 与
> `RunCallbackService.post` 复用，两者的多仓库支持是一致的。

## T6.6 GitHub Callback

> ✅ 完成（#31，`apps/server/src/github/run-callback.service.ts`；#51 起目标
> 仓库解析同 T6.5 follow-up）

Run 生命周期状态变化时，向触发该任务的原始 Issue/PR 线程发一条状态回帖评论。
触发点：`RunnerGatewayService.claim`（picked up）、`RunsService.applyStatus`
（running / failed）、`RunsService.complete`（PR created / completed）。回帖是
best-effort：调用失败只记 warning 日志，绝不影响 run 本身的状态转换（与
`PullRequestService`/#30 的失败姿态一致）。

回帖目标（`owner/repo` + issue/PR number）来自 `packages/github-adapter` 在
webhook 侧的归一化结果，写入 `Task.callbackRepo` /
`Task.callbackIssueNumber` / `Task.callbackIsPullRequest`（仅
`source: 'github'` 的任务会有值；`source: 'web'` 的任务没有回帖目标，静默跳
过）。目标仓库同样通过 `resolveTargetRepository` 解析（#51）：凭
`callbackRepo` 精确匹配项目绑定的仓库，支持多仓库项目；没有 `callbackRepo`
时仍要求项目恰好绑定一个仓库。

- [x] picked up（已领取）
- [x] running（运行中）
- [x] failed（失败）
- [x] PR created（已创建 PR）
- [x] completed（已完成）

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

> ✅ 已完成（#33，`apps/web/src/views/ProjectsView.vue` + `apps/web/src/components/RepositoryBindingPanel.vue`）
>
> Repository binding 已随 GitHub App 接入（#28）与 `/projects/:projectId/repositories`
> 端点落地，`RepositoryBindingPanel.vue` 据此渲染绑定表单/解绑操作，不再是占位提示。
> `ProjectsView.vue` 已按项目规则第 5/6 条迁移为 Tailwind utility class +
> shadcn-vue 组件（`Button`/`Input`/`Label`/`Select`/`Dialog`），不再依赖历史
> `.btn`/`.card`/`.field`/`.modal-backdrop` 自定义类。

- [x] Project list（创建 / 编辑 / 删除）
- [x] Repository binding（`RepositoryBindingPanel.vue`，依赖 GitHub App 接入 #28）
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

## T7.7 失败诊断：重试入口与 errorCode 展示

> ✅ 已完成（#61，`apps/web/src/views/TaskDetailView.vue` + `apps/web/src/api/runs.ts`）
>
> 补齐 requirements.md US-05 的两项：服务端 `POST /runs/:id/retry`（T9.2 / #39）
> 此前没有任何前端入口，`errorCode` 也没有展示（只显示 `errorMessage`）。现在：
> 最新 Run 为 `failed` 时，详情页顶部操作区出现「重试」按钮，成功后刷新任务与
> Run 列表（新 Run 为 `queued`，旧 Run 事件历史保留）；服务端返回 409
> （非 failed / 同任务仍有活动 Run）时把消息原样显示出来。概览分区新增「错误码」
> 一行。顶部操作区的按钮一并迁移为 shadcn-vue `Button`（含 `as="a"` 的打开 PR）。

- [x] `runsApi.retry`
- [x] 失败时显示重试按钮（44px 触控目标）
- [x] 展示 `errorCode`
- [x] 409 等错误可读提示

## T7.5 Mobile UX

**标记：** `[参考 Orca]`

> ✅ 已完成（#36，贯穿各页面的响应式样式，`apps/web/src/styles/main.css` + `AppShell.vue`）

要求：

- [x] iPhone 单手可操作（底部 Tab 导航、44px 最小触控目标）
- [x] Task 状态优先显示（详情页顶部 sticky 状态卡片）
- [x] Cancel 按钮可达（详情页顶部操作区）
- [x] PR 一键打开（详情页顶部 + Artifacts 分区）
- [x] Long logs 折叠（`LogViewer.vue`，超过 12 行默认折叠）

## T7.6 新建任务表单（Web 派发 Task）

> ✅ 已完成（#59，`apps/web/src/views/TasksView.vue` + `apps/web/src/lib/task-form.ts`）
>
> 补齐 requirements.md §3.1 的必做项「Web 创建 Task」/ US-01：此前
> `tasksApi.create` 已存在但没有任何视图调用，派发任务只能靠 GitHub `@agent`
> 评论或手动 `POST /tasks`。现在任务列表页顶部提供「新建任务」按钮，弹出
> shadcn-vue `Dialog` 表单（项目 `Select` + 意图 `Select` + prompt `Textarea`），
> 提交后跳转到该任务详情页；命中去重（`deduplicated`）时给出提示。校验与
> payload 构造抽到纯函数 `buildCreateTaskPayload`（`apps/web/src/lib/task-form.ts`）
> 以便在 node-only 的 vitest 环境下单测。
>
> 同时修正了任务列表状态过滤的一个缺陷：前端 `TaskStatus` 原先被定义为 Run 的
> 9 状态词汇，过滤下拉里的 `assigned` / `needs_approval` / `verifying` /
> `publishing` 会被服务端 `ListTasksQuerySchema`（`TaskStatusSchema`，仅 5 个
> 粗粒度状态）拒绝为 400。现在 `TaskStatus` 与协议对齐为 5 值，`RunStatus`
> 单独定义为 9 值。`TasksView.vue` 一并按项目规则第 5/6 条迁移为 Tailwind
> utility class + shadcn-vue 组件。

- [x] 选择 project / intent，填写 prompt
- [x] 表单校验与错误提示（含服务端 `ApiError` 消息）
- [x] 去重提示
- [x] 提交后跳转任务详情
- [x] 移动端 44px 触控目标

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

> ✅ 已完成（#37）
>
> **审批动作三类**（`@agentdock/protocol` 的 `ApprovalActionSchema`）：
> - `shell`：ACP `session/request_permission`（OpenCode 请求执行 shell / 工具调用）——
>   拦截点在 `packages/agent-runtime/src/index.ts` 的 `registerClientHandlers`，
>   通过注入的 `ApprovalGate.requestShellApproval` 决议；未配置 gate 时默认
>   `DenyingApprovalGate` 拒绝（保留 #37 之前"拒绝优先"的安全默认值）。决议后
>   会调用 `sink.status('running')` 把 Run 状态从审批请求时被强制置为的
>   `needs_approval` 报回 `running`，避免 Task Detail 一直停留在待审批状态。
> - `push`：`apps/runner/src/claim-execute-loop.ts` 在调用
>   `WorktreeManager.push()` 前，若项目 `push.requireApproval` 为 true，则先
>   请求审批（Run 短暂转入 `needs_approval`，通过后转回 `publishing` 再推送）。
> - `destructive`：复用同一套 `Approval` 模型/API，供后续标记为不可逆的操作
>   （如强制推送、删除分支）接入，`RunnerApprovalGate.requestDestructiveApproval`
>   已提供但当前无调用方，留作扩展点。
>
> **Runner 无入站通道**（architecture §9），审批决议因此复用取消信号的下发方式：
> `POST /runner/runs/:id/approvals` 创建 pending `Approval` 并把 Run 转入
> `needs_approval`；随后轮询 `POST /runner/runs/:id/heartbeat`，其响应体新增的
> `approvals` 数组带回该 run 所有仍在等待或最近已决议的审批（支持同一 run 内
> 并发多条审批，按 `approvalId` 匹配，而不是假设只有一条）。`apps/runner/src/approval-gate.ts`
> 的 `RunnerApprovalGate` 封装了这套"请求 + 轮询"逻辑，默认超时 24h 未决议按拒绝
> 处理，避免 Run 无限期挂起；`ApprovalsService.request` 对同一 run/action/summary
> 的重复请求做了幂等处理（返回既有 pending 记录而非新建），避免网络重试产生
> 重复审批。
>
> Web 端（`apps/server/src/approvals`）：`GET /approvals/pending`、
> `GET /runs/:runId/approvals`、`GET /approvals/:id`、
> `POST /approvals/:id/resolve`（`{ decision: 'approved' | 'denied', resolvedBy? }`）。
> 每次请求/决议都会在该 Run 的 `run_events` 追加一条 `type: 'approval'` 事件，
> 复用现有 SSE 通道（`GET /events/runs/:id`）实时推送给 Web，无需新增总线；
> `ApprovalPanel.vue` 复用 `TaskDetailView.vue` 已建立的同一条 SSE 订阅（不重开
> 连接），收到 `approval` 事件即触发审批列表重新拉取，5s 轮询仅作为兜底。
>
> 状态机（`@agentdock/protocol/status.ts`）扩展：`publishing` 新增
> `needs_approval` 分支（原先只能到 `succeeded`），审批通过/拒绝后回到
> `publishing` 继续或经 `failed`/`cancelled` 终止 —— 不会绕过
> `verifying → publishing` 直达 `succeeded`（architecture §8）。
>
> Prisma `Approval` model 新增 `summary` / `detailJson`（经 `redactSecrets`
> 脱敏，"Secret 不写 RunEvent" architecture §14 同样适用）/ `resolvedBy`
> 字段，`action`/`status` 改为枚举（迁移
> `20260830010000_t8_3_approval_model`）。

第二阶段：

- [x] shell approval
- [x] push approval
- [x] destructive operation approval（模型/API 已就位，暂无内部调用方触发）
- [x] `needs_approval` 运行状态贯通 UI + Runner

## T8.4 证据规则按项目配置

> ✅ 已完成（#60，`apps/server/src/projects/evidence-rules.ts` +
> `projects.evidenceRulesJson`，迁移 `20260830120000_t8_4_project_evidence_rules`）
>
> 落地 requirements.md §9 的 OPEN QUESTION。此前 `withProjectRules` 只被
> governance 自己的单测使用，`Project` 表与 `runner.config.json` 都没有对应字段，
> 服务端与 Runner 调 `decideCompletion` 都走 `DEFAULT_EVIDENCE_RULES`——项目没有
> 远端仓库 / 未装 GitHub App / `push.enabled` 保持默认 `false` 时，
> `fix` 与 `implement` 任务即使代码改对、测试通过也永远是
> `failed(evidence_incomplete)`。
>
> 现在：
> - 协议层新增 `EvidenceKindSchema` / `EvidenceRulesOverrideSchema`
>   （`@agentdock/protocol`），governance 的 `EvidenceKind` 改为从协议包复用，
>   避免两处枚举漂移。
> - `Project.evidenceRulesJson` 存 per-intent 覆盖（`null` = 用默认值），
>   Project CRUD 通过 `evidenceRules` 字段读写并做 schema 校验。
> - `RunsService.complete` 在开 PR 后重新判定时使用项目规则；
>   `parseEvidenceRules` 对非法 JSON 静默回退到默认值，而不是让 run 判定报错。
> - Runner Gateway 的 claim 响应下发 `project.evidenceRules`，
>   `apps/runner/src/claim-execute-loop.ts` 用 `withProjectRules` 合并后判定，
>   保证 Runner 的本地判定与服务端一致。
> - Web 项目表单新增「自定义证据规则」勾选与 per-intent 复选框
>   （shadcn-vue `Checkbox`）；只有与默认不同的 intent 才会写入覆盖，
>   逻辑在 `apps/web/src/lib/evidence-rules.ts`（含单测）。

- [x] `Project` 证据规则字段 + 迁移
- [x] Project CRUD 读写与校验
- [x] 服务端完成判定使用项目规则
- [x] Runner 侧使用同一份规则（随 claim 下发）
- [x] Web 表单可配置
- [x] 单测：无远端项目去掉 `pull_request` 后 `fix` 可 `succeeded`

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
- [x] Web 端重试入口（T7.7 / #61）

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

## T9.5 Audit Log

> ✅ 已完成（#63，`apps/server/src/audit/`，迁移 `20260830140000_t9_5_audit_log`）
>
> 落地 requirements.md §10 最后一条（"Audit Log 必须记录 actor、source、prompt、
> runner、executor、status、artifact"）。此前这些信息分散在 `run_events`、
> `tasks.createdBy`、`approvals.resolvedBy` 中，没有统一记录与查询入口，
> 无法回答"谁在什么时候派发 / 取消 / 审批了什么"。
>
> `audit_logs` 是**追加型**扁平表：`projectId` / `taskId` / `runId` 是普通列而不是
> 外键，审计条目要能在其描述的 task/project 被删除后继续存在。结构化细节写在
> `detailJson`（prompt 截断到 500 字符，并经 `redactSecrets` 脱敏 ——
> architecture §14 的"Secret 不写 RunEvent"同样适用）。
>
> **写入点**（每次写入都是 best-effort：审计失败只记 warning，绝不影响被审计的
> 动作本身，与 `RunCallbackService` 一致）：
> - `task_created`（`TasksService.create`，actor = `createdBy` 或来源）
> - `task_cancelled`（`TasksService.cancel`）
> - `run_claimed`（`RunnerGatewayService.claim`，actor = runner 名）
> - `run_completed`（`RunsService.complete` 与 `failDisconnected`，含 status /
>   errorCode / executor / artifact 类型列表）
> - `run_retried`（`RunsService.retry`）
> - `approval_requested` / `approval_resolved`（`ApprovalsService`）
> - `runner_registered`（首次注册）/ `runner_revoked`
>
> 查询：`GET /audit-logs`（`ApiTokenGuard`，支持 `action` / `source` / `taskId` /
> `runId` / `projectId` 过滤 + `limit`/`offset` 分页，按时间倒序）。
> `AuditModule` 声明为 `@Global`，避免各功能模块之间为了写审计产生循环依赖。

- [x] `audit_logs` 表 + 迁移
- [x] 关键动作写审计（task / run / approval / runner）
- [x] `GET /audit-logs` 过滤与分页
- [x] 脱敏后落库
- [x] 单测覆盖写入、失败不抛错、查询过滤

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

- [x] Windows 不开放 inbound OpenCode 端口（Runner 只有出站调用，执行器走 stdio；
      见 `apps/runner/src/runner-client.ts`、`packages/agent-runtime/src/acp-client.ts`）
- [x] Control Server 不保存模型 Key（配置 schema 无该字段；Runner 侧
      `assertNoEmbeddedModelKeys` 拒绝内嵌模型 Key 的配置）
- [x] 日志可追踪（RunEvent 按 `seq` 落库 + SSE 回放；e2e 检查 #8）
- [x] Run 可取消（heartbeat 下发 `cancelRequested`；e2e 检查 #9/#10）
- [x] 失败可诊断（`errorCode`/`errorMessage` + Web 重试入口，#61；e2e 检查 #11/#12/#13）
- [x] 不允许 direct push 默认分支（`WorktreeManager.push()` 拒绝，git-runtime 单测覆盖）

## 端到端验证（#64）

> ✅ 已完成（#64，`apps/server/scripts/mvp-e2e-check.ts`，记录见
> [`docs/research/mvp-e2e-verification.md`](./research/mvp-e2e-verification.md)）
>
> 可重复执行的验证脚本：`pnpm --filter @agentdock/server e2e:mvp`（前置：MySQL +
> 已应用迁移 + `.env` 或环境变量提供 `DATABASE_URL`/`API_AUTH_TOKEN`/`RUNNER_TOKEN`）。
> 脚本在同一进程内启动真实 `AppModule`，连真实 MySQL，再完全通过 HTTP 驱动 ——
> 与 Web 控制台/Runner 的调用路径一致，不需要 OpenCode 二进制或 GitHub App，
> 因此可反复执行；创建的数据在结束时删除。首次执行（2026-08-30）**17/17 通过**，
> 覆盖：双 token 隔离、Web 派发、原子 claim、单任务约束、事件顺序与回放、取消通道、
> 证据判定（严格项目失败 / 无远端项目成功）、重试与历史保留、审计日志。
>
> **仍需人工环境**的四步（GitHub webhook 触发、真实 OpenCode 执行、自动开 PR 与
> 回帖、审批门）在验证记录文档第 3 节列出了逐步操作与预期结果 —— 这些依赖只有
> 真实环境才有的外部凭据（GitHub App、模型 Provider 登录），无法在脚本里断言。

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
