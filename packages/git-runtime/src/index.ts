import { AGENT_BRANCH_PREFIX, WORKTREE_DIR, slugify } from '@agentdock/shared';

export interface WorktreeHandle {
  runId: string;
  branch: string;
  worktreePath: string;
  baseBranch: string;
}

export interface ChangeSummary {
  changedFiles: string[];
  insertions: number;
  deletions: number;
  hasChanges: boolean;
}

/** Compute the agent branch name for a run. */
export function agentBranchName(taskId: string, title: string): string {
  return `${AGENT_BRANCH_PREFIX}${taskId}-${slugify(title)}`;
}

/**
 * Manages isolated Git worktrees for runs — STUB.
 *
 * TODO(M5/T5.1): fetch, create branch from default, `git worktree add` under
 * `<projectRoot>/${WORKTREE_DIR}/<runId>`, validate clean base, cleanup.
 * TODO(M5): enforce workspace-root containment before any operation.
 */
export class WorktreeManager {
  constructor(private readonly projectRoot: string) {}

  worktreeRoot(): string {
    return `${this.projectRoot}/${WORKTREE_DIR}`;
  }

  async create(_runId: string, _baseBranch: string, _branch: string): Promise<WorktreeHandle> {
    throw new Error('WorktreeManager.create not implemented yet (M5/T5.1)');
  }

  async detectChanges(_handle: WorktreeHandle): Promise<ChangeSummary> {
    throw new Error('WorktreeManager.detectChanges not implemented yet (M5/T5.2)');
  }

  async cleanup(_handle: WorktreeHandle): Promise<void> {
    throw new Error('WorktreeManager.cleanup not implemented yet (M5/T5.1)');
  }
}
