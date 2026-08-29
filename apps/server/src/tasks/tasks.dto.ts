import {
  type TaskIntent,
  TaskIntentSchema,
  type TaskSource,
  TaskSourceSchema,
  type TaskStatus,
  TaskStatusSchema,
} from '@agentdock/protocol';
import { z } from 'zod';
import type { RunDto } from '../runs/runs.dto.js';

export const CreateTaskSchema = z.object({
  projectId: z.string().trim().min(1),
  source: TaskSourceSchema.default('web'),
  /** Normalized dedupe key (e.g. `github:owner/repo#12:comment:99`). */
  sourceRef: z.string().trim().min(1).max(300).optional(),
  /** Raw provider delivery id (GitHub `X-GitHub-Delivery`). */
  deliveryId: z.string().trim().min(1).max(120).optional(),
  intent: TaskIntentSchema.default('general'),
  prompt: z.string().trim().min(1).max(20_000),
  createdBy: z.string().trim().min(1).max(120).optional(),
  /** GitHub status-callback target (#31): `owner/repo`, set only for `source: 'github'`. */
  callbackRepo: z.string().trim().min(1).max(300).optional(),
  /** Issue/PR number the triggering event's thread belongs to (#31). */
  callbackIssueNumber: z.number().int().positive().optional(),
  callbackIsPullRequest: z.boolean().default(false),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: TaskStatusSchema.optional(),
  source: TaskSourceSchema.optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

export interface TaskDto {
  id: string;
  projectId: string;
  source: TaskSource;
  sourceRef?: string;
  deliveryId?: string;
  intent: TaskIntent;
  prompt: string;
  status: TaskStatus;
  createdBy?: string;
  callbackRepo?: string;
  callbackIssueNumber?: number;
  callbackIsPullRequest?: boolean;
  createdAt?: string;
  updatedAt?: string;
  runs?: RunDto[];
}

export interface CreateTaskResult {
  task: TaskDto;
  run?: RunDto;
  /** True when an existing task was returned because the dedupe key matched. */
  deduplicated: boolean;
}
