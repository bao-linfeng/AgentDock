import { z } from 'zod';
import { RUN_STATUSES } from './status.js';

/** Source entry points that can create a task. */
export const TaskSourceSchema = z.enum(['web', 'github']);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const TaskIntentSchema = z.enum(['fix', 'implement', 'review', 'test', 'general']);
export type TaskIntent = z.infer<typeof TaskIntentSchema>;

/**
 * Task-level status. Kept intentionally coarse; the detailed lifecycle lives on
 * AgentRun (see RunStatus). A task's status is derived from its latest run.
 */
export const TaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const RunStatusSchema = z.enum(RUN_STATUSES);

/**
 * A single piece of objective evidence a run can produce
 * (docs/requirements.md §9, docs/tasks.md T8.1). Lives in the protocol package
 * because evidence rules travel over the wire: the Control Server hands a
 * project's rules to the runner in the claim response.
 */
export const EvidenceKindSchema = z.enum([
  'git_changes',
  'test_result',
  'commit',
  'pull_request',
  'review_report',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

/**
 * Per-project override of the default per-intent evidence rules
 * (docs/requirements.md §9 review note, docs/tasks.md T8.4 / #60). Only the
 * intents present here are replaced; the rest keep `DEFAULT_EVIDENCE_RULES`
 * from `@agentdock/governance`.
 *
 * The typical use is a project without a remote (or without the GitHub App
 * configured) dropping `pull_request` from `fix` / `implement`, which would
 * otherwise make every such run fail with `evidence_incomplete`.
 */
export const EvidenceRulesOverrideSchema = z.object({
  fix: z.array(EvidenceKindSchema).optional(),
  implement: z.array(EvidenceKindSchema).optional(),
  review: z.array(EvidenceKindSchema).optional(),
  test: z.array(EvidenceKindSchema).optional(),
  general: z.array(EvidenceKindSchema).optional(),
});
export type EvidenceRulesOverride = z.infer<typeof EvidenceRulesOverrideSchema>;

export const AgentTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  source: TaskSourceSchema,
  sourceRef: z.string().optional(),
  intent: TaskIntentSchema,
  prompt: z.string().min(1),
  status: TaskStatusSchema,
  createdBy: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  runnerId: z.string().optional(),
  executor: z.literal('opencode'),
  status: RunStatusSchema,
  branch: z.string().optional(),
  worktreePath: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const RunEventTypeSchema = z.enum([
  'status',
  'log',
  'tool',
  'artifact',
  'verification',
  'error',
  /** An Approval was requested or resolved (docs/tasks.md T8.3, #37). */
  'approval',
]);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  seq: z.number().int().nonnegative(),
  type: RunEventTypeSchema,
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunArtifactSchema = z.object({
  type: z.enum(['diff', 'file', 'test_result', 'commit', 'pull_request']),
  title: z.string(),
  uri: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

export const ContextPointerSchema = z.object({
  kind: z.enum(['file', 'issue', 'pull_request', 'url', 'text']),
  ref: z.string(),
  label: z.string().optional(),
});
export type ContextPointer = z.infer<typeof ContextPointerSchema>;

export const PermissionGrantSchema = z.object({
  action: z.enum(['read', 'write', 'shell', 'git_push', 'network']),
  scope: z.string().optional(),
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export const VerificationResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  passed: z.boolean(),
  output: z.string().optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

/**
 * High-risk actions gated behind an approval (docs/tasks.md T8.3, #37):
 *  - `shell`: an ACP `session/request_permission` call from the executor
 *    (e.g. OpenCode wants to run an arbitrary shell command / tool call).
 *  - `push`: pushing the agent branch to a remote (`WorktreeManager.push`).
 *  - `destructive`: any operation the caller flags as destructive/irreversible
 *    (e.g. force-push, deleting files/branches) — reuses the same gate with a
 *    distinct action kind so the Web UI can render it with extra emphasis.
 */
export const ApprovalActionSchema = z.enum(['shell', 'push', 'destructive']);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  action: ApprovalActionSchema,
  status: ApprovalStatusSchema,
  /** Human-readable summary of what is being requested (e.g. the shell command). */
  summary: z.string().optional(),
  /** Free-form structured detail (e.g. ACP tool call payload), redacted before storage. */
  detail: z.record(z.unknown()).optional(),
  requestedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;
