import { describe, expect, it } from 'vitest';
import { PROTOCOL_SCHEMA_NAMES, exportJsonSchemas, toJsonSchema } from './json-schema.js';

describe('JSON Schema export', () => {
  it('covers every core protocol model', () => {
    expect(PROTOCOL_SCHEMA_NAMES).toContain('AgentTask');
    expect(PROTOCOL_SCHEMA_NAMES).toContain('AgentRun');
    expect(PROTOCOL_SCHEMA_NAMES).toContain('RunEvent');
    expect(PROTOCOL_SCHEMA_NAMES).toContain('RunArtifact');
    expect(PROTOCOL_SCHEMA_NAMES).toContain('CallbackRoute');
  });

  it('emits an object schema with the model properties', () => {
    const schema = toJsonSchema('AgentTask') as {
      $ref: string;
      definitions: Record<string, { type: string; properties: Record<string, unknown> }>;
    };
    expect(schema.$ref).toBe('#/definitions/AgentTask');
    const definition = schema.definitions.AgentTask;
    expect(definition.type).toBe('object');
    expect(Object.keys(definition.properties)).toContain('prompt');
    expect(Object.keys(definition.properties)).toContain('intent');
  });

  it('exports one schema per model', () => {
    const all = exportJsonSchemas();
    expect(Object.keys(all).sort()).toEqual([...PROTOCOL_SCHEMA_NAMES].sort());
  });
});
