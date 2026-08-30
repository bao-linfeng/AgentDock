import { z } from 'zod';

export const AUDIT_ACTIONS = [
  'task_created',
  'task_cancelled',
  'run_claimed',
  'run_completed',
  'run_retried',
  'approval_requested',
  'approval_resolved',
  'runner_registered',
  'runner_revoked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_SOURCES = ['web', 'github', 'runner', 'system'] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

/** One audit entry as written by `AuditService.record`. */
export interface AuditLogInput {
  action: AuditAction;
  source: AuditSource;
  /** Free-form identity: GitHub login, runner name, `web`. */
  actor?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  /** Structured detail — redacted before storage (architecture §14). */
  detail?: Record<string, unknown>;
}

export const ListAuditLogsQuerySchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  source: z.enum(AUDIT_SOURCES).optional(),
  taskId: z.string().trim().min(1).optional(),
  runId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

export interface AuditLogDto {
  id: string;
  action: AuditAction;
  source: AuditSource;
  actor?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  detail?: unknown;
  createdAt: string;
}
