import { describe, expect, it, vi } from 'vitest';
import { RunnerApprovalGate } from './approval-gate.js';
import type { RunnerClient } from './runner-client.js';

function fakeClient(overrides: Partial<RunnerClient> = {}): RunnerClient {
  return {
    requestApproval: vi.fn(),
    runHeartbeat: vi.fn(),
    ...overrides,
  } as unknown as RunnerClient;
}

describe('RunnerApprovalGate.requestShellApproval', () => {
  it('returns immediately when the server resolves the approval synchronously', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'approved' });
    const client = fakeClient({ requestApproval });
    const gate = new RunnerApprovalGate({ client, sleep: vi.fn() });

    const decision = await gate.requestShellApproval({
      runId: 'run_1',
      summary: 'run `pnpm build`',
      detail: { toolCallId: 'call_1' },
    });

    expect(decision).toBe('approved');
    expect(requestApproval).toHaveBeenCalledWith('run_1', {
      action: 'shell',
      summary: 'run `pnpm build`',
      detail: { toolCallId: 'call_1' },
    });
  });

  it('polls the heartbeat until the pending approval is resolved', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'pending' });
    const runHeartbeat = vi
      .fn()
      .mockResolvedValueOnce({
        runId: 'run_1',
        status: 'needs_approval',
        cancelRequested: false,
        approvals: [{ approvalId: 'app_1', action: 'shell', status: 'pending' }],
      })
      .mockResolvedValueOnce({
        runId: 'run_1',
        status: 'running',
        cancelRequested: false,
        approvals: [{ approvalId: 'app_1', action: 'shell', status: 'approved' }],
      });
    const client = fakeClient({ requestApproval, runHeartbeat });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const gate = new RunnerApprovalGate({ client, sleep, pollIntervalMs: 1 });

    const decision = await gate.requestShellApproval({
      runId: 'run_1',
      summary: 'run `rm -rf dist`',
      detail: {},
    });

    expect(decision).toBe('approved');
    expect(runHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('finds its own approvalId among several concurrent pending approvals', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_2', status: 'pending' });
    const runHeartbeat = vi.fn().mockResolvedValue({
      runId: 'run_1',
      status: 'needs_approval',
      cancelRequested: false,
      approvals: [
        { approvalId: 'app_1', action: 'shell', status: 'pending' },
        { approvalId: 'app_2', action: 'shell', status: 'approved' },
      ],
    });
    const client = fakeClient({ requestApproval, runHeartbeat });
    const gate = new RunnerApprovalGate({ client, sleep: vi.fn().mockResolvedValue(undefined) });

    const decision = await gate.requestShellApproval({ runId: 'run_1', summary: 'x', detail: {} });
    expect(decision).toBe('approved');
  });

  it('treats a denied decision from the poll as denied', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'pending' });
    const runHeartbeat = vi.fn().mockResolvedValue({
      runId: 'run_1',
      status: 'running',
      cancelRequested: false,
      approvals: [{ approvalId: 'app_1', action: 'shell', status: 'denied' }],
    });
    const client = fakeClient({ requestApproval, runHeartbeat });
    const gate = new RunnerApprovalGate({ client, sleep: vi.fn().mockResolvedValue(undefined) });

    const decision = await gate.requestShellApproval({ runId: 'run_1', summary: 'x', detail: {} });
    expect(decision).toBe('denied');
  });

  it('times out as denied when no decision arrives before the deadline', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'pending' });
    const runHeartbeat = vi.fn().mockResolvedValue({
      runId: 'run_1',
      status: 'needs_approval',
      cancelRequested: false,
      approvals: [{ approvalId: 'app_1', action: 'shell', status: 'pending' }],
    });
    const client = fakeClient({ requestApproval, runHeartbeat });
    let now = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const gate = new RunnerApprovalGate({
        client,
        timeoutMs: 5,
        pollIntervalMs: 1,
        sleep: async () => {
          now += 10; // exceed the timeout after the first sleep
        },
      });

      const decision = await gate.requestShellApproval({
        runId: 'run_1',
        summary: 'x',
        detail: {},
      });
      expect(decision).toBe('denied');
    } finally {
      Date.now = originalNow;
    }
  });
});

describe('RunnerApprovalGate.requestPushApproval / requestDestructiveApproval', () => {
  it('requests the push action', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'approved' });
    const client = fakeClient({ requestApproval });
    const gate = new RunnerApprovalGate({ client });

    await gate.requestPushApproval('run_1', 'push agent/x to origin', { branch: 'agent/x' });
    expect(requestApproval).toHaveBeenCalledWith('run_1', {
      action: 'push',
      summary: 'push agent/x to origin',
      detail: { branch: 'agent/x' },
    });
  });

  it('requests the destructive action', async () => {
    const requestApproval = vi.fn().mockResolvedValue({ id: 'app_1', status: 'denied' });
    const client = fakeClient({ requestApproval });
    const gate = new RunnerApprovalGate({ client });

    const decision = await gate.requestDestructiveApproval('run_1', 'delete branch old-feature');
    expect(decision).toBe('denied');
    expect(requestApproval).toHaveBeenCalledWith('run_1', {
      action: 'destructive',
      summary: 'delete branch old-feature',
      detail: undefined,
    });
  });
});
