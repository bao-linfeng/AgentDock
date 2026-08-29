-- AlterTable: projects — T8.4 per-project evidence rules (docs/tasks.md T8.4, #60)
-- Stores a partial per-intent map of required evidence kinds, validated by
-- `EvidenceRulesOverrideSchema` (@agentdock/protocol) and merged onto
-- `DEFAULT_EVIDENCE_RULES` via `withProjectRules` (@agentdock/governance).
-- NULL keeps the built-in defaults, so existing rows are unaffected.
ALTER TABLE `projects`
    ADD COLUMN `evidenceRulesJson` JSON NULL;
