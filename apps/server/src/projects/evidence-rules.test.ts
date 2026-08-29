import { DEFAULT_EVIDENCE_RULES } from '@agentdock/governance';
import { describe, expect, it } from 'vitest';
import { parseEvidenceRules, resolveEvidenceRules } from './evidence-rules.js';

describe('parseEvidenceRules', () => {
  it('treats null/undefined as no override', () => {
    expect(parseEvidenceRules(null)).toBeUndefined();
    expect(parseEvidenceRules(undefined)).toBeUndefined();
  });

  it('treats an empty object as no override', () => {
    expect(parseEvidenceRules({})).toBeUndefined();
  });

  it('ignores malformed JSON rather than failing a completion decision', () => {
    expect(parseEvidenceRules({ fix: ['not_a_kind'] })).toBeUndefined();
    expect(parseEvidenceRules('nonsense')).toBeUndefined();
  });

  it('accepts a valid partial override', () => {
    expect(parseEvidenceRules({ fix: ['git_changes', 'commit'] })).toEqual({
      fix: ['git_changes', 'commit'],
    });
  });
});

describe('resolveEvidenceRules', () => {
  it('returns the defaults when there is no override', () => {
    expect(resolveEvidenceRules(null)).toEqual(DEFAULT_EVIDENCE_RULES);
  });

  it('merges the override onto the defaults, leaving other intents alone', () => {
    const rules = resolveEvidenceRules({ fix: ['git_changes', 'test_result', 'commit'] });
    expect(rules.fix).toEqual(['git_changes', 'test_result', 'commit']);
    expect(rules.implement).toEqual(DEFAULT_EVIDENCE_RULES.implement);
  });
});
