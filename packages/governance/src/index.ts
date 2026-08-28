import type { RunArtifact, TaskIntent } from '@agentdock/protocol';

/** A single piece of evidence required for a task to be considered done. */
export type EvidenceKind =
  | 'git_changes'
  | 'test_result'
  | 'commit'
  | 'pull_request'
  | 'review_report';

/**
 * Per-intent required evidence. Made configurable rather than hard-coded so a
 * project without a remote can drop `pull_request`. See docs/requirements.md §9
 * review note.
 */
export const DEFAULT_EVIDENCE_RULES: Record<TaskIntent, EvidenceKind[]> = {
  fix: ['git_changes', 'test_result', 'commit', 'pull_request'],
  implement: ['git_changes', 'test_result', 'commit', 'pull_request'],
  test: ['git_changes', 'test_result', 'commit'],
  review: ['review_report'],
  general: [],
};

export interface EvidenceEvaluation {
  satisfied: boolean;
  missing: EvidenceKind[];
}

/**
 * Decide whether collected artifacts satisfy the required evidence — STUB logic.
 *
 * TODO(M8/T8.1): map real artifacts to evidence kinds and evaluate completion.
 * Completion is decided here by evidence, never by the agent's natural-language
 * "done" (docs/requirements.md §9, docs/tasks.md T8.2).
 */
export function evaluateEvidence(
  intent: TaskIntent,
  artifacts: RunArtifact[],
  rules: Record<TaskIntent, EvidenceKind[]> = DEFAULT_EVIDENCE_RULES,
): EvidenceEvaluation {
  const present = new Set<EvidenceKind>();
  for (const a of artifacts) {
    if (a.type === 'diff' || a.type === 'file') present.add('git_changes');
    if (a.type === 'test_result') present.add('test_result');
    if (a.type === 'commit') present.add('commit');
    if (a.type === 'pull_request') present.add('pull_request');
  }
  const missing = rules[intent].filter((kind) => !present.has(kind));
  return { satisfied: missing.length === 0, missing };
}
