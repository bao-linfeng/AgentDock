import type { CreateTaskInput, TaskIntent } from '../types';

/**
 * Pure validation/payload construction for the "new task" form
 * (docs/tasks.md T7.6, issue #59). Kept out of the component so it can be unit
 * tested without a DOM environment (the repo's vitest setup is node-only).
 */
export interface TaskFormValues {
  projectId: string;
  intent: TaskIntent;
  prompt: string;
}

export type TaskFormResult = { ok: true; payload: CreateTaskInput } | { ok: false; error: string };

/** Server-side limit: `CreateTaskSchema.prompt` is `max(20_000)`. */
export const PROMPT_MAX_LENGTH = 20_000;

export function buildCreateTaskPayload(values: TaskFormValues): TaskFormResult {
  const projectId = values.projectId.trim();
  if (!projectId) return { ok: false, error: '请选择项目' };

  const prompt = values.prompt.trim();
  if (!prompt) return { ok: false, error: '请填写任务描述（prompt）' };
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return { ok: false, error: `任务描述过长（最多 ${PROMPT_MAX_LENGTH} 字符）` };
  }

  return {
    ok: true,
    payload: { projectId, source: 'web', intent: values.intent, prompt },
  };
}
