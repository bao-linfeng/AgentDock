import type { AgentTask } from '@agentdock/protocol';
import { InvalidTransitionError } from '@agentdock/protocol';
import { describe, expect, it } from 'vitest';
import { TaskEngineError, TaskQueue, deriveTaskStatus } from './index.js';

let counter = 0;
function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  counter += 1;
  return {
    id: `task_${counter}`,
    projectId: 'proj_1',
    source: 'web',
    intent: 'fix',
    prompt: 'do a thing',
    status: 'queued',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('deriveTaskStatus', () => {
  it('maps run statuses to coarse task statuses', () => {
    expect(deriveTaskStatus('assigned')).toBe('queued');
    expect(deriveTaskStatus('verifying')).toBe('running');
    expect(deriveTaskStatus('succeeded')).toBe('succeeded');
    expect(deriveTaskStatus('cancelled')).toBe('cancelled');
  });
});

describe('TaskQueue', () => {
  it('enqueues a queued run per task', () => {
    const q = new TaskQueue();
    const { run } = q.enqueue(makeTask());
    expect(run.status).toBe('queued');
    expect(run.executor).toBe('opencode');
    expect(q.pending).toBe(1);
  });

  it('rejects enqueuing the same task twice', () => {
    const q = new TaskQueue();
    const task = makeTask();
    q.enqueue(task);
    expect(() => q.enqueue(task)).toThrow(TaskEngineError);
  });

  it('claims a run at most once and enforces one-at-a-time', () => {
    const q = new TaskQueue();
    const a = q.enqueue(makeTask());
    q.enqueue(makeTask());

    const first = q.claim('rnr_1');
    expect(first?.run.id).toBe(a.run.id);
    expect(first?.run.status).toBe('assigned');
    expect(first?.run.runnerId).toBe('rnr_1');

    // second claim blocked while one is in flight
    expect(q.claim('rnr_1')).toBeNull();
    expect(q.active?.id).toBe(a.run.id);
  });

  it('never returns the same run to concurrent claimers', () => {
    const q = new TaskQueue();
    q.enqueue(makeTask());
    q.enqueue(makeTask());
    const results = [q.claim('r'), q.claim('r'), q.claim('r')].filter((x) => x !== null);
    expect(results).toHaveLength(1);
  });

  it('frees the slot on a terminal state and lets the next run be claimed', () => {
    const q = new TaskQueue();
    q.enqueue(makeTask());
    const b = q.enqueue(makeTask());

    const first = q.claim('r');
    expect(first).not.toBeNull();
    if (!first) throw new Error('unreachable');
    q.advance(first.run.id, 'running');
    q.advance(first.run.id, 'verifying');
    q.advance(first.run.id, 'publishing');
    q.advance(first.run.id, 'succeeded');
    expect(q.active).toBeNull();

    const second = q.claim('r');
    expect(second?.run.id).toBe(b.run.id);
  });

  it('rejects illegal transitions via the state machine', () => {
    const q = new TaskQueue();
    const { run } = q.enqueue(makeTask());
    q.claim('r'); // -> assigned
    expect(() => q.advance(run.id, 'succeeded')).toThrow(InvalidTransitionError);
  });

  it('produces strictly increasing per-run sequence numbers', () => {
    const q = new TaskQueue();
    const { run } = q.enqueue(makeTask());
    const seqs = [q.nextSeq(run.id), q.nextSeq(run.id), q.nextSeq(run.id)];
    expect(seqs).toEqual([1, 2, 3]);
  });

  it('derives task status from its run', () => {
    const q = new TaskQueue();
    const { task, run } = q.enqueue(makeTask());
    expect(q.taskStatus(task.id)).toBe('queued');
    q.claim('r');
    q.advance(run.id, 'running');
    expect(q.taskStatus(task.id)).toBe('running');
  });
});
