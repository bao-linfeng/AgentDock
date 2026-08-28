import { readFile } from 'node:fs/promises';
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
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

/**
 * Load and validate runner.config.json.
 *
 * NOTE: the config file must NOT contain model API keys — those stay in the
 * user's OpenCode configuration (docs/requirements.md §7, T3.1).
 */
export async function loadConfig(path: string): Promise<RunnerConfig> {
  const raw = await readFile(path, 'utf8');
  return RunnerConfigSchema.parse(JSON.parse(raw));
}
