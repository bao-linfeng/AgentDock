import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunArtifact, RunStatus, VerificationResult } from '@agentdock/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalGate } from './index.js';
import { OpenCodeExecutor } from './index.js';
import { createFakeOpenCodeAgent } from './test-support/fake-opencode-agent.js';

/** Records every sink call for assertions. */
function createRecordingSink() {
  const statuses: RunStatus[] = [];
  const logs: string[] = [];
  const artifacts: RunArtifact[] = [];
  const verifications: VerificationResult[] = [];
  const errors: Array<{ message: string; code?: string }> = [];

  return {
    statuses,
    logs,
    artifacts,
    verifications,
    errors,
    sink: {
      async status(status: RunStatus) {
        statuses.push(status);
      },
      async log(message: string) {
        logs.push(message);
      },
      async artifact(artifact: RunArtifact) {
        artifacts.push(artifact);
      },
      async verification(result: VerificationResult) {
        verifications.push(result);
      },
      async error(message: string, code?: string) {
        errors.push({ message, code });
      },
    },
  };
}

describe('OpenCodeExecutor.canRun', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('rejects a relative workspaceCwd', async () => {
    const executor = new OpenCodeExecutor();
    const readiness = await executor.canRun({
      runId: 'run_1',
      workspaceCwd: 'relative/path',
      prompt: 'hi',
      context: [],
      permissions: [],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/absolute/);
  });

  it('rejects a workspaceCwd that does not exist', async () => {
    const executor = new OpenCodeExecutor();
    const readiness = await executor.canRun({
      runId: 'run_1',
      workspaceCwd: join(cwd, 'does-not-exist'),
      prompt: 'hi',
      context: [],
      permissions: [],
    });
    expect(readiness.ready).toBe(false);
  });

  it('accepts a valid absolute, existing workspaceCwd', async () => {
    const executor = new OpenCodeExecutor();
    const readiness = await executor.canRun({
      runId: 'run_1',
      workspaceCwd: cwd,
      prompt: 'hi',
      context: [],
      permissions: [],
    });
    expect(readiness.ready).toBe(true);
  });
});

describe('OpenCodeExecutor.run', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('streams progress and reports success on end_turn', async () => {
    const fake = createFakeOpenCodeAgent({
      updates: [
        { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working on it' } },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call_1',
          title: 'Reading file',
          status: 'in_progress',
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'done reading' } }],
        },
      ],
      stopReason: 'end_turn',
    });

    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink, statuses, logs, errors } = createRecordingSink();

    const result = await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'fix the bug', context: [], permissions: [] },
      sink,
    );

    expect(result.status).toBe('succeeded');
    expect(statuses).toContain('running');
    expect(logs.some((l) => l.includes('working on it'))).toBe(true);
    expect(logs.some((l) => l.includes('call_1'))).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('includes context pointers in the prompt sent to the agent', async () => {
    let capturedPrompt: unknown;
    const fake = createFakeOpenCodeAgent({
      stopReason: 'end_turn',
      onPrompt: (prompt) => {
        capturedPrompt = prompt;
      },
    });

    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink } = createRecordingSink();

    await executor.run(
      {
        runId: 'run_1',
        workspaceCwd: cwd,
        prompt: 'fix the bug',
        context: [{ kind: 'issue', ref: '#42', label: 'payment bug' }],
        permissions: [],
      },
      sink,
    );

    const text = JSON.stringify(capturedPrompt);
    expect(text).toContain('fix the bug');
    expect(text).toContain('#42');
    expect(text).toContain('payment bug');
  });

  it('maps a refusal stop reason to a failed result with a summary', async () => {
    const fake = createFakeOpenCodeAgent({ stopReason: 'refusal' });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink } = createRecordingSink();

    const result = await executor.run(
      {
        runId: 'run_1',
        workspaceCwd: cwd,
        prompt: 'do something risky',
        context: [],
        permissions: [],
      },
      sink,
    );

    expect(result.status).toBe('failed');
    expect(result.summary).toMatch(/refusal/);
  });

  it('bridges a failed tool_call_update to sink.error', async () => {
    const fake = createFakeOpenCodeAgent({
      updates: [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call_9',
          status: 'failed',
        },
      ],
      stopReason: 'end_turn',
    });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink, errors } = createRecordingSink();

    await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'fix the bug', context: [], permissions: [] },
      sink,
    );

    expect(errors.some((e) => e.code === 'tool_call_failed')).toBe(true);
  });

  it('redacts secrets from streamed log content', async () => {
    const fake = createFakeOpenCodeAgent({
      updates: [
        {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'using token sk-ant-abcdefghijklmnopqrstuvwx1234' },
        },
      ],
      stopReason: 'end_turn',
    });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink, logs } = createRecordingSink();

    await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'fix the bug', context: [], permissions: [] },
      sink,
    );

    const combined = logs.join('\n');
    expect(combined).not.toContain('sk-ant-abcdefghijklmnopqrstuvwx1234');
    expect(combined).toContain('[redacted:anthropic_key]');
  });

  it('reports failed and calls sink.error when the agent throws', async () => {
    const fake = createFakeOpenCodeAgent({ promptError: new Error('boom') });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink, errors } = createRecordingSink();

    const result = await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'fix the bug', context: [], permissions: [] },
      sink,
    );

    expect(result.status).toBe('failed');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects up front (without launching) when workspaceCwd is invalid', async () => {
    let launched = false;
    const fake = createFakeOpenCodeAgent();
    const executor = new OpenCodeExecutor({
      launch: () => {
        launched = true;
        return fake.handle;
      },
    });
    const { sink, errors } = createRecordingSink();

    const result = await executor.run(
      { runId: 'run_1', workspaceCwd: 'not-absolute', prompt: 'hi', context: [], permissions: [] },
      sink,
    );

    expect(result.status).toBe('failed');
    expect(launched).toBe(false);
    expect(errors[0]?.code).toBe('not_ready');
  });
});

describe('OpenCodeExecutor approval gate (docs/tasks.md T8.3, #37)', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('denies by default when no approval gate is configured', async () => {
    let observedOutcome: string | undefined;
    const fake = createFakeOpenCodeAgent({
      stopReason: 'end_turn',
      requestPermission: {
        toolCallTitle: 'Run `rm -rf build`',
        onOutcome: (outcome) => {
          observedOutcome = outcome.outcome;
        },
      },
    });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink, logs } = createRecordingSink();

    const result = await executor.run(
      {
        runId: 'run_1',
        workspaceCwd: cwd,
        prompt: 'clean the build dir',
        context: [],
        permissions: [],
      },
      sink,
    );

    expect(result.status).toBe('succeeded');
    expect(observedOutcome).toBe('cancelled');
    expect(logs.some((l) => l.includes('permission requested'))).toBe(true);
    expect(logs.some((l) => l.includes('permission denied'))).toBe(true);
  });

  it('grants the request when the approval gate approves', async () => {
    let observedOutcome: string | undefined;
    const fake = createFakeOpenCodeAgent({
      stopReason: 'end_turn',
      requestPermission: {
        toolCallTitle: 'Run `pnpm build`',
        onOutcome: (outcome) => {
          observedOutcome = outcome.outcome;
        },
      },
    });
    const gate: ApprovalGate = {
      requestShellApproval: async () => 'approved',
    };
    const executor = new OpenCodeExecutor({ launch: () => fake.handle, approvalGate: gate });
    const { sink, logs } = createRecordingSink();

    await executor.run(
      {
        runId: 'run_1',
        workspaceCwd: cwd,
        prompt: 'build the project',
        context: [],
        permissions: [],
      },
      sink,
    );

    expect(observedOutcome).toBe('selected');
    expect(logs.some((l) => l.includes('permission approved'))).toBe(true);
  });

  it('passes the runId and a human-readable summary to the approval gate', async () => {
    const fake = createFakeOpenCodeAgent({
      stopReason: 'end_turn',
      requestPermission: { toolCallTitle: 'Run `git push --force`' },
    });
    const requestShellApproval = vi.fn().mockResolvedValue('denied' as const);
    const executor = new OpenCodeExecutor({
      launch: () => fake.handle,
      approvalGate: { requestShellApproval },
    });
    const { sink } = createRecordingSink();

    await executor.run(
      { runId: 'run_42', workspaceCwd: cwd, prompt: 'push it', context: [], permissions: [] },
      sink,
    );

    expect(requestShellApproval).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run_42', summary: 'Run `git push --force`' }),
    );
  });

  it('denies (rather than throwing) when the approval gate itself throws', async () => {
    const fake = createFakeOpenCodeAgent({
      stopReason: 'end_turn',
      requestPermission: { toolCallTitle: 'Run something risky' },
    });
    const executor = new OpenCodeExecutor({
      launch: () => fake.handle,
      approvalGate: {
        requestShellApproval: async () => {
          throw new Error('server unreachable');
        },
      },
    });
    const { sink } = createRecordingSink();

    const result = await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'try it', context: [], permissions: [] },
      sink,
    );

    expect(result.status).toBe('succeeded');
  });
});

describe('OpenCodeExecutor.cancel', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('sends session/cancel to the agent and the run completes as cancelled', async () => {
    const fake = createFakeOpenCodeAgent({ delayMs: 100, stopReason: 'end_turn' });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle });
    const { sink } = createRecordingSink();

    const runPromise = executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'long task', context: [], permissions: [] },
      sink,
    );

    await fake.sessionIdPromise;
    await executor.cancel('run_1');

    const result = await runPromise;
    expect(fake.cancelReceived()).toBe(true);
    expect(result.status).toBe('cancelled');
  });

  it('is a no-op when cancelling an unknown runId', async () => {
    const executor = new OpenCodeExecutor();
    await expect(executor.cancel('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('OpenCodeExecutor timeout', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'agentdock-acp-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('cancels and reports a cancelled result when the run exceeds timeoutMs', async () => {
    const fake = createFakeOpenCodeAgent({ delayMs: 200, stopReason: 'end_turn' });
    const executor = new OpenCodeExecutor({ launch: () => fake.handle, timeoutMs: 20 });
    const { sink, errors } = createRecordingSink();

    const result = await executor.run(
      { runId: 'run_1', workspaceCwd: cwd, prompt: 'slow task', context: [], permissions: [] },
      sink,
    );

    expect(result.status).toBe('cancelled');
    expect(errors.some((e) => e.code === 'timeout')).toBe(true);
  });
});
