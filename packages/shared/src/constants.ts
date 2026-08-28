/** Default mention trigger for GitHub / chat entry points. */
export const DEFAULT_MENTION_TRIGGER = '@agent';

/** Prefix for branches created by the agent. */
export const AGENT_BRANCH_PREFIX = 'agent/';

/** Directory (relative to a project root) where isolated worktrees are created. */
export const WORKTREE_DIR = '.agent-worktrees';

/** Runner heartbeat interval in milliseconds (default). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

/** Server considers a runner offline after this many ms without a heartbeat. */
export const RUNNER_OFFLINE_TIMEOUT_MS = 45_000;
