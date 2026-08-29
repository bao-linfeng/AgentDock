import { describe, expect, it } from 'vitest';
import { PROMPT_MAX_LENGTH, buildCreateTaskPayload } from './task-form.js';

describe('buildCreateTaskPayload', () => {
  it('requires a project', () => {
    const result = buildCreateTaskPayload({ projectId: '  ', intent: 'fix', prompt: 'do it' });
    expect(result).toEqual({ ok: false, error: '请选择项目' });
  });

  it('requires a non-empty prompt', () => {
    const result = buildCreateTaskPayload({ projectId: 'proj_1', intent: 'fix', prompt: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects a prompt longer than the server limit', () => {
    const result = buildCreateTaskPayload({
      projectId: 'proj_1',
      intent: 'fix',
      prompt: 'x'.repeat(PROMPT_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it('builds a trimmed web-source payload', () => {
    const result = buildCreateTaskPayload({
      projectId: ' proj_1 ',
      intent: 'implement',
      prompt: '  add pagination  ',
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        projectId: 'proj_1',
        source: 'web',
        intent: 'implement',
        prompt: 'add pagination',
      },
    });
  });
});
