import { type EvidenceRules, withProjectRules } from '@agentdock/governance';
import { type EvidenceRulesOverride, EvidenceRulesOverrideSchema } from '@agentdock/protocol';

/**
 * Per-project evidence-rule overrides (docs/tasks.md T8.4, #60).
 *
 * `projects.evidenceRulesJson` is free-form JSON at the database level, so it is
 * re-validated on read: anything that does not parse is treated as "no override"
 * rather than failing a completion decision, which would strand runs.
 */
export function parseEvidenceRules(json: unknown): EvidenceRulesOverride | undefined {
  if (json === null || json === undefined) return undefined;
  const parsed = EvidenceRulesOverrideSchema.safeParse(json);
  if (!parsed.success) return undefined;
  // Drop a `{}` override so callers can tell "configured" from "empty".
  return Object.values(parsed.data).some((v) => v !== undefined) ? parsed.data : undefined;
}

/** Merge a project's stored override onto the built-in defaults. */
export function resolveEvidenceRules(json: unknown): EvidenceRules {
  const overrides = parseEvidenceRules(json);
  return overrides ? withProjectRules(overrides) : withProjectRules({});
}
