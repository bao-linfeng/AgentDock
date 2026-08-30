import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { containsModelKey } from '@agentdock/shared';
import { z } from 'zod';

/**
 * Push behavior for a project. `enabled: false` (the default) keeps today's
 * commit-only behavior; a project opts into pushing the agent branch to a
 * remote once it has somewhere to push to (docs/tasks.md T5.4, #27).
 */
export const PushConfigSchema = z.object({
  enabled: z.boolean().default(false),
  remote: z.string().min(1).default('origin'),
  /** Extra branches (beyond the project's `defaultBranch`) that must never be pushed to directly. */
  protectedBranches: z.array(z.string().min(1)).default([]),
  /**
   * Gate the push behind an approval (docs/tasks.md T8.3, #37): when true,
   * the runner requests approval and blocks until a decision (or timeout)
   * before pushing. Defaults to false to preserve pre-#37 behavior.
   */
  requireApproval: z.boolean().default(false),
});

/** Per-project mapping: server project id -> local workspace path. */
export const ProjectMappingSchema = z.object({
  workspacePath: z.string().min(1),
  defaultBranch: z.string().default('main'),
  push: PushConfigSchema.default({}),
});

export const RunnerConfigSchema = z.object({
  serverUrl: z.string().url(),
  runnerToken: z.string().min(1),
  runnerName: z.string().min(1),
  projects: z.record(ProjectMappingSchema).default({}),
  /**
   * Optional allow-list of roots. When set, every project `workspacePath` must
   * resolve inside one of these roots (root containment, docs/architecture.md §14).
   */
  allowedRoots: z.array(z.string().min(1)).optional(),
});

export type PushConfig = z.infer<typeof PushConfigSchema>;
export type ProjectMapping = z.infer<typeof ProjectMappingSchema>;
export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** True when `child` resolves to a path inside (or equal to) `root`. */
export function isContained(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Reject a config that embeds a model/provider API key. Keys must stay in the
 * user's OpenCode configuration, never in the runner config (requirements §7).
 */
export function assertNoEmbeddedModelKeys(rawConfigText: string): void {
  if (containsModelKey(rawConfigText)) {
    throw new ConfigError(
      'runner config appears to contain a model/provider API key; ' +
        'model keys must live in your OpenCode config, not the runner config',
    );
  }
}

export interface ValidationIssue {
  projectId: string;
  level: 'error' | 'warning';
  message: string;
}

/**
 * Validate a single workspace path: it must be contained under one of
 * `allowedRoots` (when set), exist, be a directory, and be a git repository.
 * Returns a list of issues (usually 0 or 1) rather than throwing so callers
 * can decide how to react (log-and-continue at startup, or reject-and-fail a
 * claimed run).
 *
 * This is the same check `validateProjects` runs at startup, extracted so it
 * can also be applied to a server-supplied `workspacePath` at claim time
 * (docs/architecture.md §14 root containment; #75).
 */
export async function validateWorkspacePath(
  projectId: string,
  workspacePath: string,
  allowedRoots?: string[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const wp = resolve(workspacePath);

  if (allowedRoots && !allowedRoots.some((r) => isContained(r, wp))) {
    issues.push({
      projectId,
      level: 'error',
      message: `workspacePath escapes allowedRoots: ${wp}`,
    });
  }

  try {
    const s = await stat(wp);
    if (!s.isDirectory()) {
      issues.push({
        projectId,
        level: 'error',
        message: `workspacePath is not a directory: ${wp}`,
      });
      return issues;
    }
  } catch {
    issues.push({ projectId, level: 'error', message: `workspacePath does not exist: ${wp}` });
    return issues;
  }

  try {
    await stat(resolve(wp, '.git'));
  } catch {
    issues.push({ projectId, level: 'error', message: `not a git repository: ${wp}` });
  }

  return issues;
}

/**
 * Validate project mappings against the filesystem: the path must exist, be a
 * git repository, and (if `allowedRoots` is set) be contained under an allowed
 * root. Returns a list of issues rather than throwing so a caller can surface
 * all problems at once.
 */
export async function validateProjects(config: RunnerConfig): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const [projectId, mapping] of Object.entries(config.projects)) {
    issues.push(
      ...(await validateWorkspacePath(projectId, mapping.workspacePath, config.allowedRoots)),
    );
  }

  return issues;
}

/** On POSIX, warn when the config file is group/world readable (mode & 0o077). */
export async function checkFilePermissions(path: string): Promise<ValidationIssue[]> {
  if (process.platform === 'win32') return [];
  try {
    const s = await stat(path);
    if ((s.mode & 0o077) !== 0) {
      return [
        {
          projectId: '(file)',
          level: 'warning',
          message: `config file ${path} is group/world accessible; chmod 600 recommended`,
        },
      ];
    }
  } catch {
    // handled by loadConfig
  }
  return [];
}

/**
 * Load and validate runner.config.json.
 *
 * Parses + schema-validates, then rejects any embedded model API key. Deeper
 * filesystem checks are available via `validateProjects` / `checkFilePermissions`.
 */
export async function loadConfig(path: string): Promise<RunnerConfig> {
  const raw = await readFile(path, 'utf8');
  assertNoEmbeddedModelKeys(raw);
  return RunnerConfigSchema.parse(JSON.parse(raw));
}
