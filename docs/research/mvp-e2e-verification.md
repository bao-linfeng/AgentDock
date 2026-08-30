# MVP 端到端验证记录（#64）

> 对应 docs/tasks.md 末尾的 “MVP Definition of Done” 清单。
> 首次执行：2026-08-30，Windows 11 + Node 22 + MySQL 8（`pnpm db:up`，宿主端口 3307）。

## 1. 自动验证：`pnpm --filter @agentdock/server e2e:mvp`

`apps/server/scripts/mvp-e2e-check.ts` 在**同一进程内**用真实的 `AppModule`
（与 `src/main.ts` 相同的 `rawBody` / CORS 配置）启动 Control Server，连接真实
MySQL，然后完全通过 HTTP 驱动它 —— 请求路径与 Web 控制台、Local Runner 完全一致。
它不需要真实的 OpenCode 二进制，也不需要 GitHub App，因此可以在 CI/本机重复执行。

### 前置条件

```bash
pnpm db:up                                   # MySQL 8（若 3306 被占用：MYSQL_PORT=3307）
cd apps/server && cp env.example .env        # 或用环境变量提供以下三项
#   DATABASE_URL / API_AUTH_TOKEN / RUNNER_TOKEN
pnpm prisma:deploy                           # 应用迁移
pnpm e2e:mvp
```

设置 `AGENTDOCK_URL` 可改为打到一个已在运行的 Control Server（此时脚本不再自己启动）。
脚本创建的项目名都带时间戳，结束时会删除（级联删除其 task/run/event/artifact）。

### 首次执行结果：17/17 通过

| # | 检查项 | 对应 DoD / 需求 |
| --- | --- | --- |
| 1 | `GET /health` 无需 token | architecture §14 |
| 2 | Web 路由拒绝缺失 token | requirements §10 |
| 3 | Runner 路由拒绝 Web token（双 token 独立） | architecture §14 |
| 4 | Runner 注册成功 | T3.2 |
| 5 | `POST /tasks` 创建任务 + `queued` Run | §3.1「Web 创建 Task」/ US-01 |
| 6 | `GET /runner/tasks/claim` 领取并下发项目上下文（workspacePath） | T3.4 |
| 7 | 已有在执行 Run 的 Runner 无法再领取 | T3.4「每次只执行一个任务」 |
| 8 | Run 事件按 `seq` 落库且可回放 | DoD「日志可追踪」 |
| 9 | 取消请求通过 run heartbeat 到达 Runner | US-04 / DoD「Run 可取消」 |
| 10 | 取消后的 Run 反映到 Task 状态 | US-04 |
| 11 | 缺 PR 的 `fix` Run 保持 `failed(evidence_incomplete)` | §9 / T8.2 |
| 12 | 重试产生新的 `queued` Run | US-05 / T9.2 |
| 13 | 失败 Run 的事件历史保留 | T9.2 |
| 14 | claim 响应带回项目的证据规则 | T8.4 / #60 |
| 15 | 无远端项目（去掉 `pull_request`）的 `fix` Run 判定 `succeeded` | T8.4 / #60 |
| 16 | 审计日志记录派发 / 领取 / 完成 | §10 / T9.5 |
| 17 | 审计日志记录重试 | §10 / T9.5 |

同次验证还确认了三条新迁移可在既有库上顺序应用：
`20260830010000_t8_3_approval_model` → `20260830120000_t8_4_project_evidence_rules`
→ `20260830140000_t9_5_audit_log`。

## 2. 已由其它自动化覆盖的 DoD 断言

| DoD 断言 | 覆盖方式 |
| --- | --- |
| Control Server 不保存模型 Key | 配置 schema 中没有任何模型/Provider Key 字段（`apps/server/src/config/env.ts`）；Runner 侧 `assertNoEmbeddedModelKeys` 拒绝内嵌模型 Key 的配置（`apps/runner/src/config.ts` + 单测） |
| 不允许 direct push 默认分支 | `WorktreeManager.push()` 拒绝推送 base/受保护分支，`packages/git-runtime/src/index.test.ts` 用真实 git 仓库验证 |
| 失败可诊断 | Run 持久化 `errorCode`/`errorMessage`，Web 详情页展示错误码与重试入口（#61）；`runs.service.test.ts` 覆盖各失败分支 |
| Windows 不开放 inbound OpenCode 端口 | 架构层面保证：Runner 只发出站请求（`RunnerClient` 只有 `fetch` 调用，没有任何 listen/server 代码），执行器通过 stdio 与 `opencode acp` 通讯（`packages/agent-runtime/src/acp-client.ts`） |
| ACP 连通性、取消、cwd、结构化进度 | 真实 `opencode acp` 二进制冒烟测试（T0.1 / #16，`docs/research/opencode-acp-smoke-test-notes.md`）与 OMO Slim 兼容性验证（T0.2 / #17） |
| worktree → 测试 → commit → push 全链路 | `apps/runner/src/claim-execute-loop.test.ts` 用真实 git 仓库 + 假 executor 跑完整流水线（含 push、审批门、取消、证据判定） |

## 3. 仍需人工环境的部分

以下环节依赖只有真实环境才有的外部凭据/服务，脚本不覆盖，需要按顺序人工走一遍：

1. **GitHub 侧触发**：配置 GitHub App（`GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` /
   `GITHUB_WEBHOOK_SECRET`）、把 `${PUBLIC_BASE_URL}/github/webhook` 注册为
   Webhook、在项目上绑定仓库，然后在 Issue 评论 `@agent fix ...`。
   预期：webhook 验签通过 → 归一化为 Task → 出现在 Web 任务列表。
2. **真实 OpenCode 执行**：本机 `opencode providers login` 后启动 Runner
   （`runner.config.json` 映射项目路径，`push.enabled: true`）。
   预期：worktree 隔离 → 代码改动 → 测试命令 → commit → push。
3. **自动开 PR 与回帖**：push 成功后 Control Server 自动开 PR（#30）、在原始
   Issue/PR 线程回帖（#31），Run 最终为 `succeeded`。
4. **审批门**：把项目 `push.requireApproval` 设为 true，确认 Run 进入
   `needs_approval`、Web 审批面板可决议、通过后继续推送（#37）。

这四步的每一次执行都会在 `audit_logs` 与 `run_events` 中留下记录，可用
`GET /audit-logs?taskId=...` 复核。
