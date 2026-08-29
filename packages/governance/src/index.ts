import type { RunArtifact, TaskIntent } from '@agentdock/protocol';

/** A single piece of evidence required for a task to be considered done. */
export type EvidenceKind =
  | 'git_changes'
  | 'test_result'
  | 'commit'
  | 'pull_request'
  | 'review_report';

export type EvidenceRules = Record<TaskIntent, EvidenceKind[]>;

/**
 * Per-intent required evidence. Configurable rather than hard-coded so a project
 * without a remote can drop `pull_request` (docs/requirements.md §9 review note).
 */
export const DEFAULT_EVIDENCE_RULES: EvidenceRules = {
  fix: ['git_changes', 'test_result', 'commit', 'pull_request'],
  implement: ['git_changes', 'test_result', 'commit', 'pull_request'],
  test: ['git_changes', 'test_result', 'commit'],
  review: ['review_report'],
  general: [],
};

/**
 * Merge per-project overrides onto the defaults. Only the intents present in
 * `overrides` are replaced; the rest keep their defaults.
 */
export function withProjectRules(
  overrides: Partial<EvidenceRules>,
  base: EvidenceRules = DEFAULT_EVIDENCE_RULES,
): EvidenceRules {
  return { ...base, ...overrides };
}

/**
 * Map collected artifacts to the set of evidence kinds they demonstrate.
 *
 * An artifact may also declare evidence explicitly via
 * `metadata.evidence: EvidenceKind[]` — this is how a `review` task records a
 * `review_report`, which has no dedicated artifact type.
 */
export function collectEvidence(artifacts: RunArtifact[]): Set<EvidenceKind> {
  const present = new Set<EvidenceKind>();
  for (const a of artifacts) {
    switch (a.type) {
      case 'diff':
      case 'file':
        present.add('git_changes');
        break;
      case 'test_result':
        present.add('test_result');
        break;
      case 'commit':
        present.add('commit');
        break;
      case 'pull_request':
        present.add('pull_request');
        break;
    }
    const declared = a.metadata?.evidence;
    if (Array.isArray(declared)) {
      for (const kind of declared) {
        if (isEvidenceKind(kind)) present.add(kind);
      }
    }
  }
  return present;
}

const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'git_changes',
  'test_result',
  'commit',
  'pull_request',
  'review_report',
];

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export interface EvidenceEvaluation {
  satisfied: boolean;
  missing: EvidenceKind[];
}

/**
 * Evaluate whether collected artifacts satisfy the required evidence for the
 * task intent. Completion is decided here by evidence, never by the agent's
 * natural-language "done" (docs/requirements.md §9, docs/tasks.md T8.2).
 */
export function evaluateEvidence(
  intent: TaskIntent,
  artifacts: RunArtifact[],
  rules: EvidenceRules = DEFAULT_EVIDENCE_RULES,
): EvidenceEvaluation {
  const present = collectEvidence(artifacts);
  const missing = rules[intent].filter((kind) => !present.has(kind));
  return { satisfied: missing.length === 0, missing };
}

export interface CompletionDecision extends EvidenceEvaluation {
  status: 'succeeded' | 'failed';
}

/**
 * Decide a run's terminal status from evidence alone. The agent may claim it is
 * "done", but a task only succeeds when the required evidence is satisfied.
 */
export function decideCompletion(
  intent: TaskIntent,
  artifacts: RunArtifact[],
  rules: EvidenceRules = DEFAULT_EVIDENCE_RULES,
): CompletionDecision {
  const evaluation = evaluateEvidence(intent, artifacts, rules);
  return { ...evaluation, status: evaluation.satisfied ? 'succeeded' : 'failed' };
}
