import type { Logger } from '@nestjs/common';

/** Minimal shape needed to resolve a target repository (`Repository` model). */
export interface RepositoryLike {
  owner: string;
  repo: string;
  installationId: string | null;
}

/**
 * Resolves which of a Project's bound repositories a Run should target for
 * GitHub side-effects (opening a PR, posting a status callback comment).
 *
 * Historically this only worked when the project had **exactly one** bound
 * repository — with zero or more than one, callers gave up (#51). This
 * disambiguates using the task's origin instead of guessing:
 *
 * 1. If the task carries a `callbackRepo` (`owner/repo`, set by
 *    `GitHubWebhookService` for `source: 'github'` tasks — see
 *    `packages/github-adapter`), match it against the project's bound
 *    repositories. This is unambiguous regardless of how many repositories
 *    the project has bound, since the webhook always names the exact
 *    repository that triggered the task.
 * 2. Otherwise (typically `source: 'web'` tasks, which have no originating
 *    repository to key off of) fall back to the single-bound-repository
 *    heuristic: unambiguous only when the project has exactly one.
 *
 * Returns `null` (and logs a warning for the ambiguous multi-repo case) when
 * no repository can be determined — callers treat that as "evidence/callback
 * not available yet", not a hard failure.
 */
export function resolveTargetRepository<T extends RepositoryLike>(
  repositories: T[],
  callbackRepo: string | null | undefined,
  logger: Logger,
  context: string,
): T | null {
  if (callbackRepo) {
    const match = repositories.find((r) => `${r.owner}/${r.repo}` === callbackRepo);
    if (match) return match;
    // The task named a specific repository but it isn't (or is no longer)
    // bound to this project — do not silently fall back to guessing among
    // the other bound repositories.
    logger.warn(
      `${context}: task's callbackRepo (${callbackRepo}) is not among the project's bound repositories`,
    );
    return null;
  }

  if (repositories.length === 1) return repositories[0];

  if (repositories.length > 1) {
    logger.warn(
      `${context}: project has ${repositories.length} bound repositories and the task has no callbackRepo to disambiguate (ambiguous target)`,
    );
  }
  return null;
}
