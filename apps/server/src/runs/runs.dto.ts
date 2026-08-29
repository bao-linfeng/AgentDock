import { RunArtifactSchema, RunEventTypeSchema, type RunStatus } from '@agentdock/protocol';
import { z } from 'zod';

export const AppendRunEventSchema = z.object({
  type: RunEventTypeSchema,
  /** Free-form JSON payload; secrets are redacted before it is persisted. */
  payload: z.unknown().optional(),
});
export type AppendRunEventInput = z.infer<typeof AppendRunEventSchema>;

/** Terminal statuses a runner may report on `POST /runner/runs/:id/complete`. */
export const CompleteRunSchema = z.object({
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  errorCode: z.string().trim().max(120).optional(),
  errorMessage: z.string().trim().max(4000).optional(),
  branch: z.string().trim().max(300).optional(),
  worktreePath: z.string().trim().max(1000).optional(),
  artifacts: z.array(RunArtifactSchema).default([]),
});
export type CompleteRunInput = z.infer<typeof CompleteRunSchema>;

export const HeartbeatSchema = z.object({
  /** Optional short progress note recorded as a log event. */
  note: z.string().trim().max(500).optional(),
});
export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;

export const RunEventsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
});
export type RunEventsQuery = z.infer<typeof RunEventsQuerySchema>;

export interface RunDto {
  id: string;
  taskId: string;
  runnerId?: string;
  executor: string;
  status: RunStatus;
  branch?: string;
  worktreePath?: string;
  startedAt?: string;
  finishedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  /** True once a cancellation has been requested (see heartbeat response). */
  cancelRequested: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunEventDto {
  id: string;
  runId: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: string;
}

export interface ArtifactDto {
  id: string;
  runId: string;
  type: string;
  title: string;
  uri?: string;
  metadata?: unknown;
  createdAt: string;
}
