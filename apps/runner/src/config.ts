import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { containsModelKey } from '@agentdock/shared';
import { z } from 'zod';

/** Per-project mapping: server project id -> local workspace path. */
export const ProjectMappingSchema = z.object({
  workspacePath: z.string().min(1),
  defaultBranch: z.string().default('main'),
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

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** True when `child` resolves to a path inside (or equal to) `root`. */
function isContained(root: string, child: string): boolean {
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
 * Validate project mappings against the filesystem: the path must exist, be a
 * git repository, and (if `allowedRoots` is set) be contained under an allowed
 * root. Returns a list of issues rather than throwing so a caller can surface
 * all problems at once.
 */
export async function validateProjects(config: RunnerConfig): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const [projectId, mapping] of Object.entries(config.projects)) {
    const wp = resolve(mapping.workspacePath);

    if (config.allowedRoots && !config.allowedRoots.some((r) => isContained(r, wp))) {
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
        continue;
      }
    } catch {
      issues.push({ projectId, level: 'error', message: `workspacePath does not exist: ${wp}` });
      continue;
    }

    try {
      await stat(resolve(wp, '.git'));
    } catch {
      issues.push({ projectId, level: 'error', message: `not a git repository: ${wp}` });
    }
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
