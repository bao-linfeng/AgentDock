# OpenCode Remote — Requirements

## 1. 项目目标

构建一个面向个人开发者的 Agent Control Platform：

- GitHub Issue / PR / Comment 可触发本地 OpenCode 执行任务。
- Web 端可创建、查看、取消 Agent Task。
- 本地 Windows Runner 主动连接云端，不暴露本机端口。
- OpenCode 在本地项目或隔离 Worktree 中修改代码、运行测试、提交 Commit、Push 并创建 PR。
- Web 与 GitHub 均能看到执行状态、结果、PR 链接和失败原因。
- 第一阶段只支持单用户、单 Runner、OpenCode；后续再扩展多 Runner、多 Agent、多协作平台。

## 2. 核心原则

1. **Control Plane 与 Agent Runtime 分离**
   - 云端不直接启动 OpenCode。
   - 本地 Runner 负责 Workspace、Git、OpenCode ACP、测试和产物收集。

2. **本地优先**
   - 代码、模型凭据、OpenCode Provider 配置留在本机。
   - Runner 主动 Poll / WebSocket 连接 Control Server。

3. **协议优先**
   - GitHub、Web UI 等只是任务入口。
   - 所有入口统一转换为 AgentTask / AgentRun。

4. **Agent 外部编排与 OpenCode 内部编排分离**
   - Control Server 只知道 executor=`opencode`。
   - oh-my-opencode-slim 内部的 orchestrator/designer/fixer/explorer 不暴露给 Control Server。

5. **完成必须有证据**
   - Agent 输出“完成”不等于 Task completed。
   - 可要求 tests_passed / git_diff / pull_request / CI 等 evidence。

---

## 3. MVP 范围

### 3.1 必做

- [ ] Runner 注册、鉴权、心跳
- [ ] 本地项目目录绑定
- [ ] Web 创建 Task
- [ ] GitHub Issue / Comment 创建 Task
- [ ] Task Queue
- [ ] Runner 主动领取任务
- [ ] OpenCode ACP Executor
- [ ] 实时日志 / Progress Event
- [ ] Task Cancel
- [ ] Git Worktree / 独立 Branch
- [ ] 执行测试命令
- [ ] Commit
- [ ] Push
- [ ] 创建 GitHub PR
- [ ] GitHub Comment 回传结果
- [ ] Web 展示运行状态、日志、Changed Files、PR URL

### 3.2 暂缓

- Slack / 飞书 / Telegram / Teams
- Claude Code / Codex / PI 多 Executor
- 多租户
- 多 Runner Lease 调度
- 自动 Merge
- 完整浏览器 IDE
- Docker Sandbox
- 多 Agent 并行
- 定时任务
- 复杂审批流
- 自定义 Workflow DSL

---

## 4. 用户故事

### US-01 Web 创建任务

用户选择 Project，输入：

> 修复支付回调重复处理问题，并运行相关测试。

系统创建 Task，Windows Runner 领取后调用 OpenCode。

### US-02 GitHub Issue 触发

Issue Comment：

> @agent 修复这个问题

系统将 GitHub 上下文归一化为 AgentTask，Runner 执行后创建 PR，并在原 Issue 回复结果。

### US-03 查看进度

用户可以在手机 Web 页面看到（状态词汇以 architecture.md §8 为权威，已统一）：

- queued
- assigned
- running
- needs_approval
- verifying
- publishing
- succeeded / failed / cancelled

> **[已统一 2026-08-29]** 原先的 `testing` / `pushing` / `pull_request_created` 已废弃，改用 `verifying` / `publishing`；实现见 `packages/protocol/src/status.ts` 与 `apps/server` 的 `run_events` 状态事件。

### US-04 取消任务

用户点击 Cancel：

- Control Server 给 Run 打上取消请求标记（`task_runs.cancel_requested_at`，**不引入 `cancelling` 状态**）。
- 尚未被领取的 Run 直接置为 `cancelled`。
- 已在执行的 Run：Runner 在下一次 heartbeat 响应中收到 `cancelRequested: true`。
- ACP Executor 执行 cancel。
- Runner 以 `complete { status: 'cancelled' }` 记录取消结果。

### US-05 失败可诊断

失败页面必须展示：

- 当前阶段
- Error Code
- Error Message
- 最后 N 条日志
- Test Result
- Git 状态
- 可重试入口

---

## 5. 数据模型

> **[已统一 2026-08-29]** 状态词汇以 architecture.md §8 为唯一权威来源，本节与 US-03 已回填：`AgentRun.status` 补齐 `verifying` / `publishing`，实现见 `packages/protocol/src/status.ts`。
>
> **[已定义]** `TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'`（粗粒度）。Task 状态由其**最新 Run** 的状态派生：`assigned` → `queued`；`running` / `needs_approval` / `verifying` / `publishing` → `running`；终态同名映射。实现见 `packages/task-engine` 的 `deriveTaskStatus`（重试见 tasks.md T9.2：新 Run 保留旧事件，Task 状态跟随最新 Run）。
>
> **[已决策]** **MVP 使用两个独立静态 token（Web / Runner），不做 users 表、不做 JWT**。`tasks.created_by` 为自由文本（如 GitHub 用户名）。Runner token 以 `runners.token_hash` 落库并可单独撤销。

### AgentTask

```ts
type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

interface AgentTask {
  id: string;
  projectId: string;
  source: "web" | "github";
  sourceRef?: string;
  deliveryId?: string;
  intent: "fix" | "implement" | "review" | "test" | "general";
  prompt: string;
  status: TaskStatus;
  createdBy?: string;
  createdAt: string;
}
```

### AgentRun

```ts
interface AgentRun {
  id: string;
  taskId: string;
  runnerId?: string;
  executor: "opencode";
  status:
    | "queued"
    | "assigned"
    | "running"
    | "needs_approval"
    | "verifying"
    | "publishing"
    | "succeeded"
    | "failed"
    | "cancelled";
  branch?: string;
  worktreePath?: string;
  startedAt?: string;
  finishedAt?: string;
  /** 取消请求时间戳；Runner 通过 heartbeat 响应的 cancelRequested 感知。 */
  cancelRequestedAt?: string;
}
```

### RunEvent

```ts
interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  type:
    | "status"
    | "log"
    | "tool"
    | "artifact"
    | "verification"
    | "error";
  payload: unknown;
  createdAt: string;
}
```

### Artifact

```ts
interface RunArtifact {
  type: "diff" | "file" | "test_result" | "commit" | "pull_request";
  title: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 6. GitHub 入口规则

### 支持事件

MVP：

- `issues`
- `issue_comment`
- `pull_request`
- `pull_request_review_comment`

> **[TODO]** "一个来源事件只创建一次 Task"（见下方默认触发规则第 5 条）与 tasks.md T9.3 幂等性要求，需要一个具体的唯一约束：数据模型中应新增去重键（如 GitHub `delivery_id` 或规范化后的 `source_ref`）并建唯一索引。当前 schema 无对应字段。

### 默认触发规则

仅满足以下条件时创建 Task：

1. Repository 已绑定。
2. Actor 在 Allowlist。
3. Comment 包含触发词，例如 `@agent`。
4. 不处理 Bot 自己写出的回调消息。
5. 一个来源事件只创建一次 Task。

---

## 7. OpenCode 规则

- 通过 ACP 接入，不解析 TUI stdout。
- Executor 默认工作目录必须是当前 Run 的 Worktree。
- 不允许 Agent 越出配置的 Workspace Root。
- OpenCode Provider、Model、Plugin 配置由用户本机维护。
- Control Server 不保存模型 API Key。
- oh-my-opencode-slim 属于 OpenCode 内部能力，不写入核心调度协议。

### 关键验证

必须单独做兼容性 Spike：

- ACP pure mode 下 oh-my-opencode-slim 是否加载。
- orchestrator 是否按预期工作。
- delegated agents 是否正常。
- 插件是否向 stdout 写非 ACP 内容。
- cancel 是否可靠。

> ✅ 已完成（docs/tasks.md T0.2，[#17](https://github.com/bao-linfeng/AgentDock/issues/17)）。
> 结论：`compatible_with_limitations`，详见
> [`docs/research/omo-slim-acp-compat-notes.md`](./research/omo-slim-acp-compat-notes.md)。
> MVP 无需回退到"纯 OpenCode ACP、不启用 OMO Slim"的降级路径；以下 1/2 条为
> 未来可选加固方向，非当前阻塞项。

如果 OMO Slim 与 ACP pure mode 冲突：

1. MVP 先使用纯 OpenCode ACP。
2. OMO Slim 作为可选兼容模式单独实现和测试。
3. 不允许因此把 Agent Runtime 改回 stdout parser。

---

## 8. Git 策略

默认禁止直接写目标分支。

每次 Run：

```text
base branch
   ↓
run/<task-id>-<slug>
   ↓
isolated worktree
   ↓
OpenCode
   ↓
tests
   ↓
commit
   ↓
push
   ↓
pull request
```

分支示例：

```text
agent/task-123-fix-payment-callback
```

---

## 9. Evidence / Governance

### Fix Task 最低完成条件

- [ ] Git 有变更
- [ ] Test 已执行
- [ ] Commit 已创建
- [ ] Push 成功
- [ ] PR 已创建

> **[OPEN QUESTION]** 上述 evidence 目前为硬编码五项。边界情况：项目无远端仓库、或用户只需本地验证时，"Push 成功 / PR 已创建"无法满足。建议将 evidence 规则做成 per-project 可配置，而非固定五项。

### Review Task 最低完成条件

- [ ] Review Report 已生成
- [ ] GitHub Comment 已提交

Task 的最终状态由 Task Engine 判断，不由 Agent 最后一段自然语言决定。

---

## 10. 安全要求

> **[TODO]** "Runner Token 独立且可撤销"缺少落库位置：architecture.md §7 的 `runners` 表无 `token_hash` / `revoked` 字段。请补充 Runner Token 的存储（建议存 hash）与撤销标记。

- Runner Token 独立且可撤销。
- Runner 只能执行已绑定 Project。
- Project 必须配置允许的 Workspace Root。
- GitHub Webhook 必须验签。
- 禁止执行来自未授权 Repository / Actor 的写任务。
- 默认禁止直接 Merge。
- 高风险 Shell / Git 操作的 Approval Gate（**[已实现 2026-08-30, #37]**：见
  docs/tasks.md T8.3、architecture.md §9/§15 —— shell 工具调用、push、以及标记
  为 destructive 的操作均需人工审批才能继续，未决议超时按拒绝处理）。
- Audit Log 必须记录 actor、source、prompt、runner、executor、status、artifact。

---

## 11. 来源标记

### [参考 OpenTag]

- Event normalization
- Run lifecycle
- Local Runner
- Dispatcher / polling
- ACP Executor
- GitHub adapter
- Run Event / audit 思路
- Evidence / Governance

### [可直接复用优先]

- `@opentag/core` 的协议设计
- `@opentag/runner` 的 ACP Executor 抽象
- `@opentag/github` 的事件归一化思路

### [建议自己实现]

- NestJS Control Server
- Prisma/MySQL Store
- 用户 / 项目 / Runner 管理
- WebSocket / SSE
- 自己的 Web UI
- 自己的 Task Engine
- 自己的产品权限模型

### [参考 OpenHands]

- Conversation / Timeline
- Terminal / Logs UI
- Diff UI
- Artifact UI
- Automation UI

### [参考 Orca]

> **[已核实 2026-08-29]** Orca = https://github.com/stablyai/orca —— "ADE for working with a fleet of parallel agents"，桌面 + 移动 + VPS。核心能力：移动端 Companion（iOS/Android，agent 完成通知与远程续发）、并行 Git Worktree、SSH Worktree、GitHub/Linear 原生集成，支持 Codex/ClaudeCode/OpenCode/Pi 等，MIT 协议。以下参考准确可靠。

- Mobile Remote UX
- Agent Status
- Worktree UX
- Session / Project 列表
- 完成通知

