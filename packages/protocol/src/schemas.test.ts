import { describe, expect, it } from 'vitest';
import { ApprovalActionSchema, ApprovalSchema, ApprovalStatusSchema } from './schemas.js';

describe('ApprovalSchema', () => {
  it('accepts the three approval actions', () => {
    for (const action of ['shell', 'push', 'destructive'] as const) {
      expect(ApprovalActionSchema.parse(action)).toBe(action);
    }
  });

  it('accepts pending/approved/denied statuses', () => {
    for (const status of ['pending', 'approved', 'denied'] as const) {
      expect(ApprovalStatusSchema.parse(status)).toBe(status);
    }
  });

  it('parses a minimal pending approval', () => {
    const approval = ApprovalSchema.parse({
      id: 'app_1',
      runId: 'run_1',
      action: 'shell',
      status: 'pending',
      requestedAt: new Date().toISOString(),
    });
    expect(approval.status).toBe('pending');
    expect(approval.resolvedAt).toBeUndefined();
  });

  it('parses a resolved approval with summary/detail', () => {
    const approval = ApprovalSchema.parse({
      id: 'app_2',
      runId: 'run_1',
      action: 'push',
      status: 'approved',
      summary: 'push agent/task-1-fix to origin',
      detail: { branch: 'agent/task-1-fix', remote: 'origin' },
      requestedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'web',
    });
    expect(approval.status).toBe('approved');
    expect(approval.resolvedBy).toBe('web');
  });

  it('rejects an unknown action', () => {
    expect(() =>
      ApprovalSchema.parse({
        id: 'app_3',
        runId: 'run_1',
        action: 'merge',
        status: 'pending',
        requestedAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
