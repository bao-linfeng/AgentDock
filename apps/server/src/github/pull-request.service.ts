import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GitHubAppService } from './github-app.service.js';
import { resolveTargetRepository } from './repository-resolver.js';

export interface PullRequestResult {
  number: number;
  url: string;
  title: string;
  base: string;
  head: string;
}

/** First line of the PR body links back to the originating AgentTask/Run. */
function buildBody(taskId: string, runId: string, prompt: string): string {
  const truncatedPrompt = prompt.length > 500 ? `${prompt.slice(0, 500)}…` : prompt;
  return [
    `Opened automatically by AgentDock for task \`${taskId}\` (run \`${runId}\`).`,
    '',
    '**Prompt**',
    '',
    truncatedPrompt,
  ].join('\n');
}

function buildTitle(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? '';
  const title = firstLine.length > 0 ? firstLine : 'AgentDock automated change';
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

/**
 * Opens a Pull Request for a completed run (docs/tasks.md T6.5, #30).
 *
 * Deliberately lives outside `RunsService`/`GitHubModule`'s controller
 * surface: it is called from `RunsService.complete()` (docs/architecture.md
 * §10 step 8, "Run 完成后可配置清理 Worktree" happens after PR) once the
 * runner has reported a pushed `commit` artifact, so evidence-based
 * completion (#4) can see the resulting `pull_request` artifact before the
 * final `succeeded`/`failed` decision.
 *
 * Which of the project's bound repositories to target is resolved by
 * `resolveTargetRepository` (#51): GitHub-sourced tasks carry the originating
 * `callbackRepo`, so multi-repository projects are supported as long as the
 * task names one of the bound repositories; tasks with no `callbackRepo`
 * (typically `source: 'web'`) still require the project to have exactly one
 * bound repository, since there is nothing to disambiguate with.
 */
@Injectable()
export class PullRequestService {
  private readonly logger = new Logger(PullRequestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GitHubAppService) private readonly githubApp: GitHubAppService,
  ) {}

  /**
   * Try to open a PR for `runId`'s pushed branch. Returns `null` (never
   * throws) whenever a PR cannot be attempted — no bound repository, no
   * installation, App not configured, or the branch/base are missing —
   * since the caller treats this as "evidence not available yet", not a
   * hard failure of the run itself.
   */
  async openForRun(
    runId: string,
    branch: string | null | undefined,
  ): Promise<PullRequestResult | null> {
    if (!branch) return null;
    if (!this.githubApp.isConfigured()) return null;

    const run = await this.prisma.taskRun.findUnique({
      where: { id: runId },
      include: { task: { include: { project: { include: { repositories: true } } } } },
    });
    if (!run) return null;

    const { project } = run.task;
    const repository = resolveTargetRepository(
      project.repositories,
      run.task.callbackRepo,
      this.logger,
      `run ${runId}`,
    );
    if (!repository) return null;
    if (!repository.installationId) return null;

    try {
      const pr = await this.githubApp.createPullRequest(repository.installationId, {
        owner: repository.owner,
        repo: repository.repo,
        title: buildTitle(run.task.prompt),
        body: buildBody(run.task.id, run.id, run.task.prompt),
        base: project.defaultBranch,
        head: branch,
      });
      return { ...pr, base: project.defaultBranch, head: branch };
    } catch (error) {
      this.logger.warn(
        `failed to open PR for run ${runId} (${repository.owner}/${repository.repo} ` +
          `${branch} -> ${project.defaultBranch}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
