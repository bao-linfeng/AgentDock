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
> **项目状态:早期开发中 —— Control Server 已可运行，Runner 领取→执行主循环已打通，PR 创建与 GitHub 状态回帖均已自动化。**
>
> Monorepo 脚手架已就绪，多个基础包已实现并有单元测试:protocol Schema 与
> Run 状态机、Git Worktree 运行时、GitHub 事件归一化、任务队列引擎、证据治理，
> 以及 Runner 配置/密钥脱敏。**NestJS Control Server 现已可运行**(项目、任务、
> Run、Run 事件、带取消通道的 Runner 网关，见
> [`apps/server/README.md`](./apps/server/README.md))。**OpenCode ACP 执行器已
> 实现并有单元测试**(`packages/agent-runtime`，基于 `@agentclientprotocol/sdk`），
> **Local Runner 现已打通完整的领取 → 创建工作树 → 执行 → 验证 → 提交 → 推送 →
> 上报主循环**(`apps/runner/src/claim-execute-loop.ts`)，并支持通过心跳通道
> 响应取消请求。将 agent 分支推送到已配置的远程已经实现
> (`WorktreeManager.push()`，
> [#27](https://github.com/bao-linfeng/AgentDock/issues/27))，复用项目本地
> 已有的 git 远程与凭据(等同于人工 `git push`)，按项目在
> `runner.config.json` 的 `push.enabled` 开关中启用，且默认拒绝直推
> base/受保护分支。**基于该推送分支自动创建 Pull Request 现已实现**(见
> [里程碑 6](#-里程碑与路线图) /
> [#30](https://github.com/bao-linfeng/AgentDock/issues/30)，
> `apps/server/src/github/pull-request.service.ts`):当某个 Run 已推送
> Commit 但仍缺 `pull_request` 证据时，持有 GitHub App 凭据的 Control Server
> (凭据来自 [#28](https://github.com/bao-linfeng/AgentDock/issues/28) 的仓库
> 绑定)会自动开 PR 并重新判定完成状态——因此绑定了仓库的项目，其
> `fix`/`implement` 类型任务现在可以在证据校验环节判定为 `succeeded`；**项目
> 绑定多个仓库时的 PR 目标选择问题现已修复**
> ([#51](https://github.com/bao-linfeng/AgentDock/issues/51)，
> `apps/server/src/github/repository-resolver.ts`)：通过匹配触发任务的来源
> `owner/repo` 与项目已绑定的仓库列表来确定目标仓库，而不再要求项目"恰好绑定
> 一个仓库"。**把结果
> 回评到原 GitHub 讨论线程现已实现**
> ([#31](https://github.com/bao-linfeng/AgentDock/issues/31)，
> `apps/server/src/github/run-callback.service.ts`):Control Server 会在
> Run 生命周期的关键节点(已领取、运行中、失败、已创建 PR、已完成)向触发该
> 任务的 Issue/PR 线程发一条状态回帖评论，且回帖失败不会影响 Run 本身的状态
> 流转。**Web 控制台已
> 构建完成**(仪表盘、任务列表、任务详情含 SSE 实时更新、
> 项目管理,见
> [路线图](#-里程碑与路线图) 里程碑 7)。进度与
> issue 对照见
> [`docs/tasks.md`](./docs/tasks.md) 与
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
                          │              │
                          ├──▶ needs_approval（可重入：running / verifying / publishing）
                          ├──▶ failed
                          └──▶ cancelled
```

在核心状态之上额外增加 `verifying` 与 `publishing`，方便 UI 清晰展示
测试 → Commit → Push → PR 各阶段。`needs_approval` 是一个可重入的侧支状态
（docs/tasks.md T8.3，[#37](https://github.com/bao-linfeng/AgentDock/issues/37)）：
`running` 或 `publishing` 遇到高风险操作（shell 工具调用 / push / 标记为破坏性
的操作）需要人工决策时会转入该状态，决议后回到发起请求的状态继续，不会绕过
中间阶段直达 `succeeded`。

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

> Monorepo 结构(基于 pnpm workspace)。`packages/` 下的基础包与 `apps/server`
> 已实现并测试;`apps/runner`、`apps/web` 仍为脚手架，详见 [项目状态](#-项目简介)。

```text
AgentDock/
├── apps/
│   ├── server/           # NestJS 控制端(Task Engine / GitHub Adapter / Runner Gateway / API)
│   ├── runner/           # 本地 Runner 客户端(ACP 驱动 / Git Worktree / 进程生命周期)
│   └── web/              # Web 控制台与移动端 Dashboard(Vue 3 / Vite / Pinia / TanStack Query)
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

## 🚀 快速开始

> [!IMPORTANT]
> **Control Server 现在已经可以跑起来**(里程碑 2)，**Local Runner 现已支持
> 完整的领取→执行→推送主循环**(里程碑 3/5,见下文第 3 步)，**Web 控制台已
> 构建完成**(里程碑 7，见下文第 4 步)。**推送后自动创建 PR 现已实现**(#30),
> 因此第 3 步反映的是当前实际可运行的端到端效果 —— 按项目配置推送分支后，
> Control Server 会自动开 PR，Run 随后完成为 `succeeded`。见
> [路线图](#-里程碑与路线图)。

### 前置依赖

- **Node.js**：`>= 22.0.0`
- **pnpm**：`>= 10.0.0`
- **MySQL**：`>= 8.0`(或用 Docker：`pnpm db:up`)
- **Git**：`>= 2.30.0`
- **OpenCode**：本地已安装并配置好模型凭据

### 1. 安装依赖

```bash
git clone https://github.com/bao-linfeng/AgentDock.git
cd AgentDock
pnpm install
```

### 2. 配置与启动 Control Server

> [!TIP]
> 下面第 2–4 步是首次配置时逐个启动每个服务的完整流程。一旦
> `apps/server/.env` 与 `apps/runner/runner.config.json` 都已存在，之后可以在
> 仓库根目录用一条命令同时启动 Control Server、Local Runner 与 Web 控制台：
> `pnpm dev`(会先构建 workspace 包，再并行启动三者，日志带前缀区分；Runner
> 会先等待 `GET /health` 就绪后才注册，不用担心启动顺序竞争)。

```bash
pnpm db:up            # 用 Docker 起 MySQL 8(3306 被占用时 MYSQL_PORT=3307)
cd apps/server
cp env.example .env
```

```env
DATABASE_URL="mysql://root:agentdock@localhost:3306/agentdock"
PORT=3100
PUBLIC_BASE_URL="https://your-tunnel.example.com"
# 两个相互独立的静态 token(MVP 不做 users 表)。生成强随机值：
#   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
API_AUTH_TOKEN="your-web-token"
RUNNER_TOKEN="your-runner-token"
GITHUB_WEBHOOK_SECRET=""
GITHUB_APP_ID=""
GITHUB_PRIVATE_KEY=""
```

```bash
pnpm prisma:migrate   # 建表
pnpm dev              # http://localhost:3100/health
```

完整接口清单(Web API 与 Runner Gateway)见
[`apps/server/README.md`](./apps/server/README.md)。除 `GET /health` 外所有路由
都需要 token,且 Web token 与 Runner token 必须不同。

### 3. 配置与启动 Local Runner

`workspacePath` 的权威来源是**服务端**——请在 Web 控制台「Projects → Runner
映射」面板（或调用 `PUT /runners/:id/projects/:projectId`）把项目映射到这台
Runner；claim 响应下发的正是这份路径，Runner 实际执行用的也是它（#76）。本地
`runner.config.json` 启动只需要 `serverUrl`、`runnerToken`、`runnerName`：

```bash
cd apps/runner
cp runner.config.example.json runner.config.json
```

```json
{
  "serverUrl": "http://localhost:3100",
  "runnerToken": "your-runner-token-generated-from-server",
  "runnerName": "my-dev-workstation"
}
```

`projects` 下的每项配置是**可选的本地策略**，不是映射来源——其中的
`workspacePath`（若填写）只作为漂移/篡改校验：若服务端下发的路径与本地填写
值不一致，Runner 会拒绝执行该 Run（#76）。`push`（是否推送/远程名/受保护分
支/审批）目前仍留在本地，待其下沉为项目级、Web 可配的策略后再迁移（#78）：

```json
{
  "serverUrl": "http://localhost:3100",
  "runnerToken": "your-runner-token-generated-from-server",
  "runnerName": "my-dev-workstation",
  "projects": {
    "proj_123": {
      "workspacePath": "/path/to/local/project",
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

Runner 启动后会先注册、开始心跳，随后每 5 秒轮询一次
`GET /runner/tasks/claim`；一旦目标项目有排队任务，就会创建独立工作树、
通过 ACP 运行 OpenCode、执行验证(可选测试命令)、本地提交，并在该项目开启了
`push.enabled` 时把 agent 分支推送到已配置的远程(复用本机已有的 git 凭据；
默认拒绝直推 base/受保护分支)。Control Server 一旦看到已推送的 Commit，会
用仓库绑定时授权的 GitHub App 凭据自动创建 PR(#30;要求目标项目恰好绑定
一个 GitHub 仓库),因此 `fix`/`implement` 类型的任务现在可以端到端完成为
`succeeded`;不要求 PR 证据的 `general` 类型任务始终可以正常完成。Control
Server 完成后还会向触发该任务的 GitHub 讨论线程回帖执行结果(#31)。

### 4. 启动 Web 控制台

```bash
cd apps/web
pnpm dev
```

打开浏览器访问 `http://localhost:5173`，用 `API_AUTH_TOKEN` 登录。开发环境下
控制台会把 `/api/*` 代理到 Control Server(见 `apps/web/vite.config.ts`)。
在「任务」页可以直接派发任务（「新建任务」表单，
[#59](https://github.com/bao-linfeng/AgentDock/issues/59)）：选择项目与意图、
填写 prompt 即可，已映射的 Runner 会在下一次 claim 轮询时领取。

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

- ✅ **Milestone 0 —— 技术验证与协议定义** *(已完成)* ([#16](https://github.com/bao-linfeng/AgentDock/issues/16) [#17](https://github.com/bao-linfeng/AgentDock/issues/17) [#18](https://github.com/bao-linfeng/AgentDock/issues/18))
  - ✅ OpenCode ACP Smoke Test（[#16](https://github.com/bao-linfeng/AgentDock/issues/16)，`packages/agent-runtime/src/smoke/opencode-acp-smoke.ts`） · ✅ OMO Slim 兼容性（[#17](https://github.com/bao-linfeng/AgentDock/issues/17)，`packages/agent-runtime/src/smoke/omo-slim-acp-smoke.ts` —— 结论：`compatible_with_limitations`，详见 [`docs/research/omo-slim-acp-compat-notes.md`](./docs/research/omo-slim-acp-compat-notes.md)） · ✅ OpenTag Runner 代码研读（[#18](https://github.com/bao-linfeng/AgentDock/issues/18)，详见 [`docs/research/opentag-runner-notes.md`](./docs/research/opentag-runner-notes.md)）
- ✅ **Milestone 1 —— Monorepo 与 Protocol 包** *(已完成)*
  - ✅ pnpm workspace 脚手架
  - ✅ `@agentdock/protocol` Zod Schema 与 Run 状态机，含 `CallbackRoute` 与 JSON Schema 导出（[#62](https://github.com/bao-linfeng/AgentDock/issues/62)）
- ✅ **Milestone 2 —— Control Server 基础** *(已完成)* (epic [#6](https://github.com/bao-linfeng/AgentDock/issues/6):[#19](https://github.com/bao-linfeng/AgentDock/issues/19) [#20](https://github.com/bao-linfeng/AgentDock/issues/20) [#21](https://github.com/bao-linfeng/AgentDock/issues/21) [#22](https://github.com/bao-linfeng/AgentDock/issues/22))
  - ✅ NestJS 模块(Auth / Projects / Tasks / Runs / Runners / GitHub / Events)
  - ✅ Prisma Schema 与 MySQL 迁移 · Project CRUD
  - ✅ Runner 网关(claim / events / heartbeat / complete)与经 heartbeat 下发的取消通道
- ✅ **Milestone 3 —— Local Runner** *(已完成)* ([#23](https://github.com/bao-linfeng/AgentDock/issues/23) [#24](https://github.com/bao-linfeng/AgentDock/issues/24) [#75](https://github.com/bao-linfeng/AgentDock/issues/75) [#76](https://github.com/bao-linfeng/AgentDock/issues/76))
  - ✅ Runner 配置安全与密钥处理 ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ✅ 任务领取引擎核心 ([#3](https://github.com/bao-linfeng/AgentDock/issues/3))
  - ✅ Runner 侧注册/心跳循环 (#23) · ✅ 领取→执行主循环 (#24)
  - ✅ 项目映射：`workspacePath` 的权威来源是服务端（`runner_projects`），claim 时会对照本地 `allowedRoots` 强制校验（[#75](https://github.com/bao-linfeng/AgentDock/issues/75)）；本地 `runner.config.json` 的项目条目现在只是可选的漂移/篡改校验值，不再是第二份事实来源，重复的本地 `defaultBranch` 字段也已移除（[#76](https://github.com/bao-linfeng/AgentDock/issues/76)）
- 🟡 **Milestone 4 —— Agent Runtime** (epic [#7](https://github.com/bao-linfeng/AgentDock/issues/7):[#25](https://github.com/bao-linfeng/AgentDock/issues/25) [#26](https://github.com/bao-linfeng/AgentDock/issues/26))
  - ✅ `AgentExecutor` 接口
  - ✅ OpenCode ACP Executor · ACP → RunEvent 桥接（基于 `@agentclientprotocol/sdk`，见 `packages/agent-runtime`）
- ✅ **Milestone 5 —— Git Runtime** *(已完成)* ([#27](https://github.com/bao-linfeng/AgentDock/issues/27))
  - ✅ Worktree 管理、变更检测、验证 ([#1](https://github.com/bao-linfeng/AgentDock/issues/1))
  - ✅ Commit(本地提交，随 #24 完成) · ✅ Push 新分支 + 拒绝直推 base/受保护分支 ([#27](https://github.com/bao-linfeng/AgentDock/issues/27))
- ✅ **Milestone 6 —— GitHub 集成** *(已完成)* ([#28](https://github.com/bao-linfeng/AgentDock/issues/28) [#29](https://github.com/bao-linfeng/AgentDock/issues/29) [#30](https://github.com/bao-linfeng/AgentDock/issues/30) [#31](https://github.com/bao-linfeng/AgentDock/issues/31))
  - ✅ 事件归一化与 `@agent` Mention 触发 ([#2](https://github.com/bao-linfeng/AgentDock/issues/2))
  - ✅ GitHub App / Installation 鉴权与仓库↔项目绑定 ([#28](https://github.com/bao-linfeng/AgentDock/issues/28)，`apps/server/src/github`)
  - ✅ Webhook 验签与投递去重 ([#29](https://github.com/bao-linfeng/AgentDock/issues/29))
  - ✅ PR 创建 ([#30](https://github.com/bao-linfeng/AgentDock/issues/30)，`apps/server/src/github/pull-request.service.ts`) · ✅ 回调评论 ([#31](https://github.com/bao-linfeng/AgentDock/issues/31)，`apps/server/src/github/run-callback.service.ts`)
- ✅ **Milestone 7 —— Web Dashboard 与移动端适配** *(已完成)* (epic [#8](https://github.com/bao-linfeng/AgentDock/issues/8):[#32](https://github.com/bao-linfeng/AgentDock/issues/32)–[#36](https://github.com/bao-linfeng/AgentDock/issues/36)、[#59](https://github.com/bao-linfeng/AgentDock/issues/59))
  - ✅ Dashboard、任务列表、任务详情（时间线/输出/日志/Diff/测试/产物）、移动端体验
  - ✅ 项目（CRUD 与 Runner 映射已完成；仓库绑定已随 #28 打通，Webhook 触发投递已随 #29 打通；已迁移为 Tailwind v4 + shadcn-vue）
  - ✅ 控制台内派发任务（[#59](https://github.com/bao-linfeng/AgentDock/issues/59)，`TasksView.vue` 的「新建任务」表单）
  - ✅ 失败可诊断：任务详情页的重试入口与 `errorCode` 展示（[#61](https://github.com/bao-linfeng/AgentDock/issues/61)）
- ✅ **Milestone 8 —— 治理(Governance)** ([#37](https://github.com/bao-linfeng/AgentDock/issues/37))
  - ✅ Evidence 校验引擎与基于证据的完成判定 ([#4](https://github.com/bao-linfeng/AgentDock/issues/4))
  - ✅ 证据规则按项目配置 ([#60](https://github.com/bao-linfeng/AgentDock/issues/60))：没有远端仓库（或未配置 GitHub App）的项目可以去掉 `pull_request`，不再让每个 `fix` 任务都失败于 `evidence_incomplete`。配置存在项目上（`projects.evidenceRulesJson`），合并到默认规则之上，Control Server 与 Runner 共用同一份（随 claim 响应下发）。
  - ✅ 审批模型 ([#37](https://github.com/bao-linfeng/AgentDock/issues/37))：shell / push / 破坏性操作三类审批门，`needs_approval` 已贯通 Runner（`apps/runner/src/approval-gate.ts`）与 Web 端（`apps/server/src/approvals`、`apps/web/src/components/ApprovalPanel.vue`）
- ✅ **Milestone 9 —— 稳定性** (epic [#9](https://github.com/bao-linfeng/AgentDock/issues/9):[#38](https://github.com/bao-linfeng/AgentDock/issues/38) [#39](https://github.com/bao-linfeng/AgentDock/issues/39) [#40](https://github.com/bao-linfeng/AgentDock/issues/40))
  - ✅ 敏感信息脱敏 ([#5](https://github.com/bao-linfeng/AgentDock/issues/5))
  - ✅ 统一 Audit Log ([#63](https://github.com/bao-linfeng/AgentDock/issues/63))：`audit_logs` 表 + `GET /audit-logs`，覆盖任务派发/取消、Run 领取/完成/重试、审批请求与决议、Runner 注册与吊销；细节脱敏后落库
  - ✅ 幂等:Task 去重键、原子 claim、complete 守卫 ([#40](https://github.com/bao-linfeng/AgentDock/issues/40))
  - ✅ 断线重连处理(心跳超时扫描，中断孤儿 Run) · 重试(新 Run ID，保留历史) ([#38](https://github.com/bao-linfeng/AgentDock/issues/38) [#39](https://github.com/bao-linfeng/AgentDock/issues/39))

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
- [`docs/research/mvp-e2e-verification.md`](./docs/research/mvp-e2e-verification.md) —— MVP DoD 端到端验证：可重复执行的脚本（`pnpm --filter @agentdock/server e2e:mvp`）覆盖了什么，以及仍需真实 GitHub App + OpenCode 登录才能走的四步（[#64](https://github.com/bao-linfeng/AgentDock/issues/64)）

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 开源。
