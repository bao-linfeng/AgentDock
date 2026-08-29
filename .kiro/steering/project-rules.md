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


## 4. 处理 issue 需通过 PR 分支修复，合并后关闭 issue

- 修复某个 issue 时，必须新建独立分支（不直接在 main/master 上修改），分支名建议包含 issue 编号，如 `fix/issue-<编号>-简述`。
- 在该分支完成修复并自测通过后，使用 `gh pr create` 创建 PR，PR 描述中应关联对应 issue（如使用 `Closes #<编号>` 或 `Fixes #<编号>`，或在描述中显式说明关联的 issue）。
- PR 合并后，必须确认对应 issue 已关闭；若未通过关键字自动关闭，需手动执行 `gh issue close <编号> --repo bao-linfeng/AgentDock` 关闭该 issue。
- 关闭前应确认修复内容确实解决了 issue 描述的问题，避免误关闭未完全解决的 issue。


## 5. Web 端样式必须使用 TailwindCSS（v4）

- `apps/web` 已集成 **TailwindCSS v4**，采用 CSS-first 配置：无 `tailwind.config.ts` / `postcss.config.js`，而是通过 `apps/web/vite.config.ts` 中的 `@tailwindcss/vite` 插件接入，主题令牌与 `@theme inline` 定义在 `apps/web/src/styles/main.css` 顶部。
- 新增或修改 Vue 组件的样式时，一律优先使用 Tailwind utility class（在 `<template>` 中通过 `class` 书写），禁止新增自定义 CSS 类或 `<style>` 中的手写规则，除非是 Tailwind 无法表达的场景（如复杂动画、第三方组件覆盖），此时需在代码注释中说明原因。
- 颜色、圆角等设计令牌统一维护在 `src/styles/main.css`：`:root` 中的 `--palette-*` 为基础色值，语义化 token（`--background`、`--primary`、`--border` 等，供 shadcn-vue 组件使用）在其下方定义并通过 `@theme inline` 映射为 Tailwind 的 `--color-*` / `--radius-*` 变量。新增设计令牌需同步更新 `--palette-*` 和对应的语义 token，不要在组件里硬编码颜色值。
- 现存于 `src/styles/main.css` 中的历史自定义类（`.btn`、`.card` 等）和各组件 `<style scoped>` 块，属于历史代码，在整体重构前可继续使用；但涉及该组件的新功能开发或较大改动时，应逐步将其迁移为 Tailwind utility class 和 shadcn-vue 组件（见第 6 条）。
- 若新增页面或组件后样式未生效，先检查文件是否被 Tailwind v4 默认的自动内容扫描覆盖（`index.html`、`src/**/*.{vue,ts,tsx}`），必要时在 `main.css` 中用 `@source` 显式声明扫描路径。

## 6. Web 端组件必须使用 shadcn-vue

- `apps/web` 已通过 shadcn-vue CLI 将组件源码拷贝到本地 `apps/web/src/components/ui/`（而非作为 npm 依赖引入），配置见 `apps/web/components.json`（style: `new-york`，baseColor: `neutral`，图标库 `lucide`）。
- 新增 UI 组件需求时，一律先用 shadcn-vue CLI 从官方仓库拉取到本地，而不是手写或引入其他组件库：
  - 查看可用组件：`pnpm dlx shadcn-vue@latest view <组件名>`
  - 添加组件：`pnpm dlx shadcn-vue@latest add <组件名...> -c apps/web -y`
  - CLI 会把组件源码写入 `apps/web/src/components/ui/<组件名>/`，可直接改动以适配业务需求（组件属于本地代码，不是黑盒依赖）。
- 业务组件（如 `StatusBadge.vue`、`AppShell.vue`）应基于 `components/ui/*` 中的 shadcn-vue 原语组合而成，通过 Tailwind class 或 `class` prop 传入定制样式，禁止绕过 shadcn-vue 组件另起一套等价的自定义组件（如自定义 Button/Card/Dialog）。
- `cn()` 工具函数位于 `apps/web/src/lib/utils.ts`（`clsx` + `tailwind-merge`），shadcn-vue 组件与业务组件合并 class 时应统一使用它，不要手写字符串拼接类名。
- 路径别名 `@/*` → `apps/web/src/*` 已在 `tsconfig.json` 与 `vite.config.ts` 中配置，shadcn-vue 组件导入固定使用 `@/components/ui/...`、`@/lib/utils` 等别名路径。
- 现有业务视图/组件中尚未迁移到 shadcn-vue 的部分（如各 `views/*.vue` 中的表单、列表结构），属于历史代码，可继续使用；但新功能开发或较大改动时应优先替换为对应的 shadcn-vue 组件（`Button`、`Card`、`Input`、`Dialog`、`Select` 等）。
