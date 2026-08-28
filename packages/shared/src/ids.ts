import { randomUUID } from 'node:crypto';

/**
 * Generate a prefixed, sortable-ish identifier, e.g. `task_a1b2c3...`.
 * Prefixes keep IDs self-describing in logs and URLs.
 */
export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

export const newTaskId = () => createId('task');
export const newRunId = () => createId('run');
export const newRunnerId = () => createId('rnr');
export const newProjectId = () => createId('proj');

/** Turn a free-form title into a branch-safe slug. */
export function slugify(input: string, maxLength = 40): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength) || 'task';
}
