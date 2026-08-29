import type { RunArtifact } from '@agentdock/protocol';
import { describe, expect, it } from 'vitest';
import { collectEvidence, decideCompletion, evaluateEvidence, withProjectRules } from './index.js';

const diff: RunArtifact = { type: 'diff', title: 'changes' };
const test: RunArtifact = { type: 'test_result', title: 'tests' };
const commit: RunArtifact = { type: 'commit', title: 'commit' };
const pr: RunArtifact = { type: 'pull_request', title: 'PR #1' };

describe('collectEvidence', () => {
  it('maps artifact types to evidence kinds', () => {
    const present = collectEvidence([diff, test, commit, pr]);
    expect([...present].sort()).toEqual(['commit', 'git_changes', 'pull_request', 'test_result']);
  });

  it('reads explicit evidence from metadata (review_report)', () => {
    const report: RunArtifact = {
      type: 'file',
      title: 'review.md',
      metadata: { evidence: ['review_report'] },
    };
    expect(collectEvidence([report]).has('review_report')).toBe(true);
  });
});

describe('evaluateEvidence', () => {
  it('reports missing evidence for a fix task', () => {
    const result = evaluateEvidence('fix', [diff, commit]);
    expect(result.satisfied).toBe(false);
    expect(result.missing.sort()).toEqual(['pull_request', 'test_result']);
  });

  it('is satisfied when all required evidence is present', () => {
    expect(evaluateEvidence('fix', [diff, test, commit, pr]).satisfied).toBe(true);
  });

  it('a general task needs no evidence', () => {
    expect(evaluateEvidence('general', []).satisfied).toBe(true);
  });
});

describe('decideCompletion', () => {
  it('fails when evidence is missing, even if the agent says done', () => {
    expect(decideCompletion('fix', [diff]).status).toBe('failed');
  });

  it('succeeds only when evidence is satisfied', () => {
    expect(decideCompletion('fix', [diff, test, commit, pr]).status).toBe('succeeded');
  });

  it('a review task succeeds with a review report', () => {
    const report: RunArtifact = {
      type: 'file',
      title: 'review.md',
      metadata: { evidence: ['review_report'] },
    };
    expect(decideCompletion('review', [report]).status).toBe('succeeded');
  });
});

describe('withProjectRules', () => {
  it('lets a remote-less project drop the pull_request requirement', () => {
    const rules = withProjectRules({ fix: ['git_changes', 'test_result', 'commit'] });
    const decision = decideCompletion('fix', [diff, test, commit], rules);
    expect(decision.status).toBe('succeeded');
    // other intents keep their defaults
    expect(rules.implement).toContain('pull_request');
  });
});
