import { ApprovalActionSchema } from '@agentdock/protocol';
import type { ApprovalAction, ApprovalStatus } from '@agentdock/protocol';
import { z } from 'zod';

/** Runner-initiated request to gate a high-risk action behind approval (#37). */
export const RequestApprovalSchema = z.object({
  action: ApprovalActionSchema,
  summary: z.string().trim().max(2000).optional(),
  /** Free-form JSON; redacted before persistence, same as run-event payloads. */
  detail: z.record(z.unknown()).optional(),
});
export type RequestApprovalInput = z.infer<typeof RequestApprovalSchema>;

/** Web-initiated decision on a pending approval. */
export const ResolveApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  /** Free-form identity string for the audit trail (no user system in MVP). */
  resolvedBy: z.string().trim().max(200).optional(),
});
export type ResolveApprovalInput = z.infer<typeof ResolveApprovalSchema>;

export interface ApprovalDto {
  id: string;
  runId: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  summary?: string;
  detail?: unknown;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}
