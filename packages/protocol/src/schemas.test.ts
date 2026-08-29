import { describe, expect, it } from 'vitest';
import {
  ApprovalActionSchema,
  ApprovalSchema,
  ApprovalStatusSchema,
  CallbackRouteSchema,
  callbackRouteFrom,
} from './schemas.js';

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

describe('CallbackRouteSchema', () => {
  it('parses an issue thread with defaults applied', () => {
    const route = CallbackRouteSchema.parse({ repo: 'acme/widgets', issueNumber: 7 });
    expect(route).toEqual({
      provider: 'github',
      repo: 'acme/widgets',
      issueNumber: 7,
      isPullRequest: false,
    });
  });

  it('rejects a repo that is not `owner/repo`', () => {
    expect(() => CallbackRouteSchema.parse({ repo: 'widgets', issueNumber: 7 })).toThrow();
    expect(() =>
      CallbackRouteSchema.parse({ repo: 'acme/widgets/extra', issueNumber: 7 }),
    ).toThrow();
  });

  it('rejects a non-positive issue number', () => {
    expect(() => CallbackRouteSchema.parse({ repo: 'acme/widgets', issueNumber: 0 })).toThrow();
  });
});

describe('callbackRouteFrom', () => {
  it('returns null for a task without a callback target (source: web)', () => {
    expect(callbackRouteFrom({})).toBeNull();
    expect(callbackRouteFrom({ callbackRepo: null, callbackIssueNumber: null })).toBeNull();
  });

  it('builds a route from the flat task columns', () => {
    expect(
      callbackRouteFrom({
        callbackRepo: 'acme/widgets',
        callbackIssueNumber: 12,
        callbackIsPullRequest: true,
      }),
    ).toEqual({
      provider: 'github',
      repo: 'acme/widgets',
      issueNumber: 12,
      isPullRequest: true,
    });
  });

  it('returns null when stored values are malformed rather than throwing', () => {
    expect(callbackRouteFrom({ callbackRepo: 'nonsense', callbackIssueNumber: 12 })).toBeNull();
  });
});
