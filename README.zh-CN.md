# AgentDock

<p align="center">
  <strong>面向本地编程智能体的本地优先控制平面。</strong><br>
  Local-first control plane for coding agents.
</p>

<p align="center">
  <a href="./README.md">English</a> •
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-系统架构">系统架构</a> •
  <a href="#-目录结构">目录结构</a> •
  <a href="#-技术栈">技术栈</a> •
  <a href="#-快速开始规划中">快速开始</a> •
  <a href="#-里程碑与路线图">路线图</a>
</p>

---

> [!NOTE]
> **项目状态:早期开发中 —— 已有可构建的基础，MVP 推进中。**
>
> Monorepo 脚手架已就绪，多个基础包已实现并有单元测试:protocol Schema 与
> Run 状态机、Git Worktree 运行时、GitHub 事件归一化、任务队列引擎、证据治理，
> 以及 Runner 配置/密钥脱敏。端到端产品(NestJS Control Server、OpenCode ACP
> 执行器、Web 控制台)**尚未构建** —— 下文 [快速开始](#-快速开始规划中) 描述的是
> *规划中* 的体验。进度与 issue 对照见 [`docs/tasks.md`](./docs/tasks.md) 与
> [GitHub issues](https://github.com/bao-linfeng/AgentDock/issues)。

---

## 📖 项目简介

**AgentDock** 是一个面向个人开发者与小型团队的 **本地优先(Local-first)Agent 控制平面**。

愿景:随时随地——无论是通过 Web、手机浏览器，还是在 GitHub Issue/PR 下输入
`@agent`——向运行在 **你本机** 的编程智能体(如
[OpenCode](https://github.com/sst/opencode))分发代码修复、特性开发与代码审查任务。
本地 Runner 通过 **仅出站连接(Outbound Connection)** 与云端控制中心保持通信，
**无需开放任何公网端口或配置内网穿透**。代码与模型凭据始终安全保存在你的本地机器上。

### 💡 核心设计原则

1. **Control Plane 与 Agent Runtime 严格分离** —— 云端仅负责任务调度、权限校验、
   事件分发与状态展示，不直接接触源码与模型密钥；本地 Runner 负责执行环境、
   Git 隔离、测试与编译。
2. **本地优先与隐私安全** —— 代码仓库、本地环境依赖、大模型 API 密钥只存留在
   本地开发机。
3. **协议优先(Protocol-First)** —— 基于标准化的 Agent 协议数据模型
   (`AgentTask` / `AgentRun` / `RunEvent` / `RunArtifact`)，将 GitHub、Web UI
   等不同入口归一化处理。
4. **Agent 外部编排与内部编排分离** —— Control Server 只知道 `executor = opencode`，
   OpenCode 内部的编排能力不暴露给 Control Server。
5. **证据驱动的完成判定(Evidence-based Governance)** —— 任务是否完成由客观证据
   (代码 Diff、单元测试通过、Git Commit、PR 创建)裁决，而非 Agent 的自然语言回复。
6. **Git Worktree 物理隔离** —— Agent 的所有改动均在独立的 Git Worktree 中进行，
   杜绝直接污染工作区或未保护的主分支。

---

## ✨ 核心特性

> 以下描述的是 **目标** 能力。当前实现进度请见 [路线图](#-里程碑与路线图)
> (基础包已构建并测试，端到端闭环推进中)。

- 🔒 **本地优先与零入站端口暴露** —— Windows/macOS/Linux 本地 Runner 主动轮询或
  与云端 Control Server 保持出站长连接，内网与企业网络环境无缝运行。
- 🤖 **标准化 Agent Client Protocol (ACP)** —— 通过结构化 ACP 协议与 OpenCode 等
  Agent 交互，精准捕获 Tool 调用、日志流与产物，告别脆弱的 stdout 正则解析。
- 🌿 **Git Worktree 隔离运行** —— 每个 Run 自动创建独立分支与 Worktree，自动运行
  测试命令并提交代码，支持自动创建 Pull Request。
- 🐙 **GitHub 原生事件驱动** —— 支持 Issue / PR 评论中 `@agent` 触发，任务执行完毕后
  自动回评执行日志、测试结果及关联 PR。
- 📱 **移动端友好的监控控制台** —— 随时查看任务状态(Queued、Assigned、Running、
  Verifying、Publishing、Succeeded)、实时日志、Diff 变更与一键取消。
- 🛡️ **安全沙箱与审计保障** —— 严格限制执行目录范围(Workspace Root Containment)，
  过滤敏感 Token / 密钥，操作留痕可追溯。

---

## 🏗️ 系统架构

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

### Control Server 与 Local Runner 职责边界

| Control Server(云端，NestJS)           | Local Runner(本地机器)                  |
| --------------------------------------- | --------------------------------------- |
| 身份认证与权限                          | Runner 注册与心跳                       |
| Project / Repository / Runner 配置      | Project 路径映射                        |
| GitHub Webhook 归一化                   | Git Worktree 生命周期                   |
| Task 创建与 Task/Run 状态机             | OpenCode ACP 执行                       |
| Runner 任务分配                         | 进程生命周期与取消                      |
| Event 持久化与 Artifact 元数据          | 测试 / 构建执行                         |
| Web API + SSE/WebSocket                 | Commit / Push                           |
| 基于证据的完成判定                      | Artifact 收集与进度流                   |
| **绝不** 接触源码与模型密钥             | **绝不** 保存模型 Provider 密钥         |

---

## 🔁 任务状态机

```text
queued ──▶ assigned ──▶ running ──▶ verifying ──▶ publishing ──▶ succeeded
                          │
                          ├──▶ needs_approval
                          ├──▶ failed
                          └──▶ cancelled
```

在核心状态之上额外增加 `verifying` 与 `publishing`，方便 UI 清晰展示
测试 → Commit → Push → PR 各阶段。

### 核心协议数据模型

系统将每个入口归一化为下列模型(见 [`docs/requirements.md`](./docs/requirements.md)):

- **`AgentTask`** —— 来自某来源(`web` / `github`)的意图单元
  (`fix` / `implement` / `review` / `test` / `general`)。
- **`AgentRun`** —— 某 Executor(`opencode`)对任务的一次执行尝试，
  跟踪分支、Worktree 路径与状态。
- **`RunEvent`** —— 有序的事件流条目(`status` / `log` / `tool` /
  `artifact` / `verification` / `error`)。
- **`RunArtifact`** —— 产出物(`diff` / `file` / `test_result` /
  `commit` / `pull_request`)。

---

## 📁 目录结构

> **规划中** 的 Monorepo 结构(基于 pnpm workspace)。`packages/` 下的基础包已实现
> 并测试;`apps/` 仍为脚手架，详见 [项目状态](#-项目简介)。

```text
AgentDock/
├── apps/
│   ├── server/           # NestJS 控制端(Task Engine / GitHub Adapter / Runner Gateway / API)
│   ├── runner/           # 本地 Runner 客户端(ACP 驱动 / Git Worktree / 进程生命周期)
│   └── web/              # Web 控制台与移动端 Dashboard(Vue 3 / Vite / Pinia / TailwindCSS)
│
├── packages/
│   ├── protocol/         # 核心数据模型与 Zod Schema(AgentTask, AgentRun, RunEvent, Artifact)
│   ├── agent-runtime/    # Agent 执行器抽象与 ACP 客户端
│   ├── git-runtime/      # Git Worktree 管理、变更检测与分支操作
│   ├── github-adapter/   # GitHub Webhook 归一化与 API 回调
│   ├── task-engine/      # 任务状态机与调度引擎
│   ├── governance/       # 证据校验与完成规则引擎
│   └── shared/           # 通用工具库与常量
│
├── docs/                 # 架构设计、需求规范与任务分解文档
│   ├── requirements.md
│   ├── architecture.md
│   └── tasks.md
│
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 🧰 技术栈

> 推荐技术栈来自 [`docs/architecture.md`](./docs/architecture.md)。

| 模块           | 技术选型                                                             |
| -------------- | ------------------------------------------------------------------- |
| `apps/server`  | NestJS · Prisma · MySQL 8 · WebSocket/SSE · Octokit(Redis 可选，MVP 不引入) |
| `apps/runner`  | Node.js 22+ · TypeScript · ACP client/runtime · simple-git 或 child_process 调 Git CLI · Zod |
| `apps/web`     | Vue 3 · Vite · TypeScript · Pinia · TanStack Query · shadcn-vue 或 Element Plus |
| 工程工具       | pnpm workspace(Monorepo)                                          |

---

## 🚀 快速开始(规划中)

> [!IMPORTANT]
> **以下步骤当前尚不可用。** 它们描述的是对应里程碑(见 [路线图](#-里程碑与路线图))
> 实现之后的预期开发体验。本仓库目前没有任何可运行的代码、`package.json` 或构建。

### 前置依赖(规划中)

- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 9.0.0`
- **MySQL**：`>= 8.0`
- **Git**：`>= 2.30.0`
- **OpenCode**：本地已安装并配置好模型凭据

### 1. 安装依赖(规划中)

```bash
git clone https://github.com/your-org/AgentDock.git
cd AgentDock
pnpm install
```

### 2. 配置与启动 Control Server(规划中)

```bash
cd apps/server
cp .env.example .env
```

```env
DATABASE_URL="mysql://root:password@localhost:3306/agentdock"
PORT=3000
JWT_SECRET="your-jwt-secret"
GITHUB_WEBHOOK_SECRET="your-github-webhook-secret"
GITHUB_APP_ID="your-app-id"
GITHUB_PRIVATE_KEY="your-private-key"
```

```bash
pnpm prisma migrate dev
pnpm dev
```

### 3. 配置与启动 Local Runner(规划中)

```bash
cd apps/runner
cp runner.config.example.json runner.config.json
```

```json
{
  "serverUrl": "http://localhost:3000",
  "runnerToken": "your-runner-token-generated-from-server",
  "runnerName": "my-dev-workstation",
  "projects": {
    "proj_123": {
      "workspacePath": "/path/to/local/project",
      "defaultBranch": "main"
    }
  }
}
```

```bash
pnpm start
```

### 4. 启动 Web 控制台(规划中)

```bash
cd apps/web
pnpm dev
```

打开浏览器访问 `http://localhost:5173`。

---

## 🔄 典型工作流

### 场景一:Web / 手机端派发任务

1. 打开 Web 控制台，选择目标项目(如 `PaymentService`)。
2. 输入提示词:*"修复支付回调重复处理问题，并补充相关单元测试。"*
3. Control Server 创建 Task 并排队。
4. 本地 Runner 领取任务，在 `.agent-worktrees/run-xxx` 创建独立工作区。
5. OpenCode(通过 ACP)自动分析代码、修复逻辑并运行测试验证。
6. 校验通过后自动提交 Commit、推送到远端并创建 PR。
7. Web 控制台实时查看执行日志与 PR 链接。

### 场景二:GitHub Issue 联动

1. 在已绑定仓库的 Issue 下评论:`@agent 修复支付回调重复处理问题`。
2. GitHub Webhook 通知 Control Server，标准化为 `AgentTask`。
3. 本地 Runner 认领并执行完成后，在原 Issue 回复执行总结、Changed Files 及 Pull Request 链接。

---

## 🗺️ 里程碑与路线图

里程碑与进度记录在 [`docs/tasks.md`](./docs/tasks.md)，含完整的"任务 ↔ issue"对照表。
图例:✅ 已完成 · 🟡 部分完成 · ⬜ 待办。基础包(#1–#5)已合并，接下来是端到端闭环。

- ⬜ **Milestone 0 —— 技术验证与协议定义** ([#16](https://github.com/bao-linfeng/AgentDock/issues/16) [#17](https://github.com/bao-linfeng/AgentDock/issues/17) [#18](https://github.com/bao-linfeng/AgentDock/issues/18))
  - OpenCode ACP Smoke Test · OMO Slim 兼容性 · OpenTag Runner 代码研读
- 🟡 **Milestone 1 —— Monorepo 与 Protocol 包** *(已完成)*
  - ✅ pnpm workspace 脚手架
  - ✅ `@agentdock/protocol` Zod Schema 与 Run 状态机(`CallbackRoute` / JSON Schema 导出待补)
- ⬜ **Milestone 2 —— Control Server 基础** (epic [#6](https://github.com/bao-linfeng/AgentDock/issues/6):[#19](https://github.com/bao-linfeng/AgentDock/issues/19) [#20](https://github.com/bao-linfeng/AgentDock/issues/20) [#21](https://github.com/bao-linfeng/AgentDock/issues/21) [#22](https://github.com/bao-linfeng/AgentDock/issues/22))
  - NestJS 模块 · Prisma Schema 与 MySQL 模型 · Project CRUD · Runner 网关 + 取消通道
- 🟡 **Milestone 3 —— Local Runner** ([#23](https://github.com/bao-linfeng/AgentDock/issues/23) [#24](https://github.com/bao-linfeng/AgentDock/issues/24))
  - ✅ Runner 配置安全与密钥处理 ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ✅ 任务领取引擎核心 ([#3](https://github.com/bao-linfeng/AgentDock/issues/3))
  - ⬜ 注册/心跳 · 领取→执行主循环
- 🟡 **Milestone 4 —— Agent Runtime** (epic [#7](https://github.com/bao-linfeng/AgentDock/issues/7):[#25](https://github.com/bao-linfeng/AgentDock/issues/25) [#26](https://github.com/bao-linfeng/AgentDock/issues/26))
  - ✅ `AgentExecutor` 接口
  - ⬜ OpenCode ACP Executor · ACP → RunEvent 桥接
- 🟡 **Milestone 5 —— Git Runtime** ([#27](https://github.com/bao-linfeng/AgentDock/issues/27))
  - ✅ Worktree 管理、变更检测、验证 ([#1](https://github.com/bao-linfeng/AgentDock/issues/1))
  - ⬜ Commit / Push(禁止直接 push 默认分支)
- 🟡 **Milestone 6 —— GitHub 集成** ([#28](https://github.com/bao-linfeng/AgentDock/issues/28) [#29](https://github.com/bao-linfeng/AgentDock/issues/29) [#30](https://github.com/bao-linfeng/AgentDock/issues/30) [#31](https://github.com/bao-linfeng/AgentDock/issues/31))
  - ✅ 事件归一化与 `@agent` Mention 触发 ([#2](https://github.com/bao-linfeng/AgentDock/issues/2))
  - ⬜ Webhook 验签与去重 · PR 创建 · 回调评论
- ⬜ **Milestone 7 —— Web Dashboard 与移动端适配** (epic [#8](https://github.com/bao-linfeng/AgentDock/issues/8):[#32](https://github.com/bao-linfeng/AgentDock/issues/32)–[#36](https://github.com/bao-linfeng/AgentDock/issues/36))
  - Dashboard、项目、任务列表、任务详情、移动端体验
- 🟡 **Milestone 8 —— 治理(Governance)** ([#37](https://github.com/bao-linfeng/AgentDock/issues/37))
  - ✅ Evidence 校验引擎与基于证据的完成判定 ([#4](https://github.com/bao-linfeng/AgentDock/issues/4))
  - ⬜ 审批模型(第二阶段)
- 🟡 **Milestone 9 —— 稳定性** (epic [#9](https://github.com/bao-linfeng/AgentDock/issues/9):[#38](https://github.com/bao-linfeng/AgentDock/issues/38) [#39](https://github.com/bao-linfeng/AgentDock/issues/39) [#40](https://github.com/bao-linfeng/AgentDock/issues/40))
  - ✅ 敏感信息脱敏 ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ⬜ 断线重连处理 · 重试 · 幂等

### 明确不做(在单机 OpenCode + GitHub 闭环跑通之前)

Slack / 飞书 / Telegram · Claude / Codex / PI Executor · 多租户 ·
多 Runner Lease 调度 · 自动 Merge · 完整浏览器 IDE · Docker Sandbox ·
多 Agent 并行 · 定时任务 · 复杂审批流 · Workflow DSL。

---

## 🤝 参与贡献

AgentDock 处于早期开发阶段 —— 基础包已构建，端到端闭环正在拼装。当前的贡献方式:

- 认领一个开放 [issue](https://github.com/bao-linfeng/AgentDock/issues)(参见
  [`docs/tasks.md`](./docs/tasks.md) 中的"任务 ↔ issue"对照表)。
- 阅读 [`docs/`](./docs) 下的设计文档，就需求、架构或任务分解提出反馈。

- [`docs/requirements.md`](./docs/requirements.md) —— 项目目标、MVP 范围、数据模型、安全要求
- [`docs/architecture.md`](./docs/architecture.md) —— 系统边界、技术栈、协议、数据库、工作流
- [`docs/tasks.md`](./docs/tasks.md) —— 逐里程碑的任务分解

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。
