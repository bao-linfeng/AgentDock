import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GitHubAppService } from './github-app.service.js';

/** Lifecycle points that get a status comment on the originating thread (#31). */
export type RunCallbackKind = 'picked_up' | 'running' | 'failed' | 'pr_created' | 'completed';

export interface RunCallbackContext {
  runId: string;
  /** Only set for `pr_created`. */
  pullRequest?: { number: number; url: string };
  errorMessage?: string;
}

function buildBody(kind: RunCallbackKind, ctx: RunCallbackContext): string {
  switch (kind) {
    case 'picked_up':
      return `🤖 AgentDock picked up this task (run \`${ctx.runId}\`).`;
    case 'running':
      return `⚙️ AgentDock is now working on this task (run \`${ctx.runId}\`).`;
    case 'failed':
      return [
        `❌ AgentDock run \`${ctx.runId}\` failed.`,
        ctx.errorMessage ? `\n${ctx.errorMessage}` : undefined,
      ]
        .filter(Boolean)
        .join('\n');
    case 'pr_created':
      return `🔀 AgentDock opened ${ctx.pullRequest?.url} for this task (run \`${ctx.runId}\`).`;
    case 'completed':
      return `✅ AgentDock run \`${ctx.runId}\` completed successfully.`;
  }
}

/**
 * Posts run-lifecycle status comments back to the GitHub Issue/PR thread
 * that triggered the task (docs/tasks.md T6.6, #31; architecture §11 "GitHub
 * Callback" is the final step of the workflow diagram).
 *
 * Mirrors `PullRequestService`'s shape and failure posture: every call here
 * is best-effort. A run's lifecycle must never fail or block because a
 * comment couldn't be posted (missing App config, revoked installation,
 * rate limit, ...) — errors are logged and swallowed.
 *
 * Only fires for tasks that carry a callback target (`callbackRepo` +
 * `callbackIssueNumber`, set by `GitHubWebhookService` from the normalized
 * webhook event — see `packages/github-adapter`). `source: 'web'` tasks have
 * no thread to reply to and are silently skipped.
 */
@Injectable()
export class RunCallbackService {
  private readonly logger = new Logger(RunCallbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GitHubAppService) private readonly githubApp: GitHubAppService,
  ) {}

  async post(kind: RunCallbackKind, ctx: RunCallbackContext): Promise<void> {
    if (!this.githubApp.isConfigured()) return;

    const run = await this.prisma.taskRun.findUnique({
      where: { id: ctx.runId },
      include: { task: { include: { project: { include: { repositories: true } } } } },
    });
    if (!run) return;

    const { task } = run;
    if (!task.callbackRepo || task.callbackIssueNumber === null) return;

    const { project } = task;
    if (project.repositories.length !== 1) return;
    const repository = project.repositories[0];
    if (!repository.installationId) return;

    try {
      await this.githubApp.createIssueComment(repository.installationId, {
        owner: repository.owner,
        repo: repository.repo,
        issueNumber: task.callbackIssueNumber,
        body: buildBody(kind, ctx),
      });
    } catch (error) {
      this.logger.warn(
        `failed to post ${kind} callback comment for run ${ctx.runId} ` +
          `(${repository.owner}/${repository.repo}#${task.callbackIssueNumber}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
