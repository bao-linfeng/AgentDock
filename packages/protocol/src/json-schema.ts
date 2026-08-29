import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  AgentRunSchema,
  AgentTaskSchema,
  ApprovalSchema,
  CallbackRouteSchema,
  ContextPointerSchema,
  EvidenceRulesOverrideSchema,
  PermissionGrantSchema,
  RunArtifactSchema,
  RunEventSchema,
  VerificationResultSchema,
} from './schemas.js';

/**
 * JSON Schema export for the core protocol models (docs/tasks.md T1.2, #62).
 *
 * The Zod schemas stay the single source of truth; this exists so the protocol
 * can be consumed outside TypeScript (external tooling, docs, other-language
 * clients) without hand-maintaining a second copy.
 */
export const PROTOCOL_SCHEMAS = {
  AgentTask: AgentTaskSchema,
  AgentRun: AgentRunSchema,
  RunEvent: RunEventSchema,
  RunArtifact: RunArtifactSchema,
  ContextPointer: ContextPointerSchema,
  PermissionGrant: PermissionGrantSchema,
  CallbackRoute: CallbackRouteSchema,
  VerificationResult: VerificationResultSchema,
  Approval: ApprovalSchema,
  EvidenceRulesOverride: EvidenceRulesOverrideSchema,
} satisfies Record<string, ZodTypeAny>;

export type ProtocolSchemaName = keyof typeof PROTOCOL_SCHEMAS;

export const PROTOCOL_SCHEMA_NAMES = Object.keys(PROTOCOL_SCHEMAS) as ProtocolSchemaName[];

/** JSON Schema (draft 2019-09, as emitted by `zod-to-json-schema`) for one model. */
export function toJsonSchema(name: ProtocolSchemaName): Record<string, unknown> {
  return zodToJsonSchema(PROTOCOL_SCHEMAS[name], { name }) as Record<string, unknown>;
}

/** JSON Schema for every protocol model, keyed by model name. */
export function exportJsonSchemas(): Record<ProtocolSchemaName, Record<string, unknown>> {
  const out = {} as Record<ProtocolSchemaName, Record<string, unknown>>;
  for (const name of PROTOCOL_SCHEMA_NAMES) {
    out[name] = toJsonSchema(name);
  }
  return out;
}
