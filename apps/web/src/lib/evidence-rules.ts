import {
  DEFAULT_EVIDENCE_RULES,
  type EvidenceKind,
  type EvidenceRulesOverride,
  type TaskIntent,
} from '../types';

/**
 * Editing helpers for per-project evidence rules (docs/tasks.md T8.4, issue #60).
 *
 * The project form edits a full per-intent map, but only the intents that
 * actually differ from `DEFAULT_EVIDENCE_RULES` are sent to the server, so the
 * stored override stays minimal and future changes to the defaults keep
 * applying to everything a project did not explicitly customise.
 */
export type EditableEvidenceRules = Record<TaskIntent, EvidenceKind[]>;

/** Intents exposed in the form. `general` requires no evidence and is left alone. */
export const EDITABLE_INTENTS: TaskIntent[] = ['fix', 'implement', 'test', 'review'];

export function toEditableRules(override?: EvidenceRulesOverride | null): EditableEvidenceRules {
  const editable = {} as EditableEvidenceRules;
  for (const intent of Object.keys(DEFAULT_EVIDENCE_RULES) as TaskIntent[]) {
    editable[intent] = [...(override?.[intent] ?? DEFAULT_EVIDENCE_RULES[intent])];
  }
  return editable;
}

function sameKinds(a: EvidenceKind[], b: EvidenceKind[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((kind, i) => kind === sortedB[i]);
}

/**
 * Build the payload for `evidenceRules`. Returns `null` when the project should
 * fall back to the defaults (either customisation is off, or nothing differs).
 */
export function fromEditableRules(
  editable: EditableEvidenceRules,
  enabled: boolean,
): EvidenceRulesOverride | null {
  if (!enabled) return null;
  const override: EvidenceRulesOverride = {};
  for (const intent of Object.keys(DEFAULT_EVIDENCE_RULES) as TaskIntent[]) {
    if (!sameKinds(editable[intent], DEFAULT_EVIDENCE_RULES[intent])) {
      override[intent] = [...editable[intent]];
    }
  }
  return Object.keys(override).length ? override : null;
}

export function toggleKind(list: EvidenceKind[], kind: EvidenceKind, checked: boolean): void {
  const index = list.indexOf(kind);
  if (checked && index === -1) list.push(kind);
  if (!checked && index !== -1) list.splice(index, 1);
}
