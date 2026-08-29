import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  RUN_STATUSES,
  assertTransition,
  canTransition,
  isTerminal,
} from './status.js';

describe('run status state machine', () => {
  it('walks the happy path queued -> succeeded', () => {
    const path = ['queued', 'assigned', 'running', 'verifying', 'publishing', 'succeeded'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      if (from === undefined || to === undefined) throw new Error('unreachable');
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('allows failed/cancelled from any non-terminal state', () => {
    for (const s of RUN_STATUSES) {
      if (isTerminal(s)) continue;
      expect(canTransition(s, 'failed')).toBe(true);
      expect(canTransition(s, 'cancelled')).toBe(true);
    }
  });

  it('forbids leaving terminal states', () => {
    expect(canTransition('succeeded', 'running')).toBe(false);
    expect(canTransition('failed', 'queued')).toBe(false);
    expect(canTransition('cancelled', 'running')).toBe(false);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('queued', 'running')).toBe(false);
    expect(canTransition('running', 'publishing')).toBe(false);
    expect(canTransition('assigned', 'succeeded')).toBe(false);
  });

  it('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('queued', 'succeeded')).toThrow(InvalidTransitionError);
  });

  it('supports approval loop: running -> needs_approval -> running', () => {
    expect(canTransition('running', 'needs_approval')).toBe(true);
    expect(canTransition('needs_approval', 'running')).toBe(true);
  });

  it('supports approval loop during publishing: publishing -> needs_approval -> publishing (docs/tasks.md T8.3, #37)', () => {
    expect(canTransition('publishing', 'needs_approval')).toBe(true);
    expect(canTransition('needs_approval', 'publishing')).toBe(true);
  });

  it('still requires succeeded to be reached through publishing, not needs_approval directly', () => {
    expect(canTransition('needs_approval', 'succeeded')).toBe(false);
  });
});
