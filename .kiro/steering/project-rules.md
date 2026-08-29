# AgentDock 项目协作规则

本文件为项目级约定，默认在所有会话中生效。

## 1. 使用 gh 获取 issue 与 PR

- 查看、检索 issue 和 PR 时，一律使用 GitHub CLI（`gh`），而不是猜测或依赖记忆。
- 常用命令：
  - `gh issue list --repo bao-linfeng/AgentDock --state all`
  - `gh issue view <编号> --repo bao-linfeng/AgentDock`
  - `gh pr list --repo bao-linfeng/AgentDock --state all`
  - `gh pr view <编号> --repo bao-linfeng/AgentDock`
- 处理某个 issue 前，先用 `gh issue view` 拉取最新内容与讨论，以其为准。

## 2. 始终使用中文回复

- 与用户的所有对话、说明、总结一律使用中文。
- 代码、命令、标识符、issue/PR 标题与正文可保留英文（沿用仓库现有风格），但面向用户的解释必须是中文。

## 3. 修复 issue 时保持本地文件同步

- 修复 / 实现某个 issue 若引入任何变动，必须同步更新本地相关文件，确保仓库内容与改动一致，不留下过时内容。
- 需要一并检查并更新的内容包括但不限于：
  - 相关源码及其测试；
  - 文档（如 `docs/`、`README.md`、`README.zh-CN.md`）中与该变动相关的描述、进度、路线图；
  - 配置与示例文件（如 `.example` 文件、schema）。
- 完成后运行校验（`pnpm typecheck`、`pnpm test`、`pnpm lint`）确认仓库处于绿色状态，再提交。
