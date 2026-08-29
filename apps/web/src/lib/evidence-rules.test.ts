import { describe, expect, it } from 'vitest';
import { fromEditableRules, toEditableRules, toggleKind } from './evidence-rules.js';

describe('toEditableRules', () => {
  it('falls back to the defaults when there is no override', () => {
    expect(toEditableRules(null).fix).toEqual([
      'git_changes',
      'test_result',
      'commit',
      'pull_request',
    ]);
  });

  it('applies the stored override per intent', () => {
    const editable = toEditableRules({ fix: ['git_changes', 'commit'] });
    expect(editable.fix).toEqual(['git_changes', 'commit']);
    // Untouched intents keep the defaults.
    expect(editable.test).toEqual(['git_changes', 'test_result', 'commit']);
  });
});

describe('fromEditableRules', () => {
  it('returns null when customisation is off', () => {
    expect(fromEditableRules(toEditableRules(null), false)).toBeNull();
  });

  it('returns null when nothing differs from the defaults', () => {
    expect(fromEditableRules(toEditableRules(null), true)).toBeNull();
  });

  it('only sends the intents that differ', () => {
    const editable = toEditableRules(null);
    editable.fix = ['git_changes', 'test_result', 'commit'];
    expect(fromEditableRules(editable, true)).toEqual({
      fix: ['git_changes', 'test_result', 'commit'],
    });
  });

  it('ignores ordering differences', () => {
    const editable = toEditableRules(null);
    editable.fix = ['commit', 'pull_request', 'git_changes', 'test_result'];
    expect(fromEditableRules(editable, true)).toBeNull();
  });
});

describe('toggleKind', () => {
  it('adds and removes without duplicating', () => {
    const list: Parameters<typeof toggleKind>[0] = ['commit'];
    toggleKind(list, 'commit', true);
    expect(list).toEqual(['commit']);
    toggleKind(list, 'pull_request', true);
    expect(list).toEqual(['commit', 'pull_request']);
    toggleKind(list, 'commit', false);
    expect(list).toEqual(['pull_request']);
  });
});
