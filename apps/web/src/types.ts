// Front-end mirrors of apps/server DTOs (see apps/server/src/**/*.dto.ts).
// Kept as plain TS types (no zod) — the server is the single source of validation truth.

export type TaskSource = 'web' | 'github';
export type TaskIntent = 'fix' | 'implement' | 'review' | 'test' | 'general';

/**
 * Coarse task-level status — mirrors `TaskStatusSchema` in @agentdock/protocol.
 * The detailed 9-state lifecycle lives on runs (`RunStatus`); a task's status is
 * derived from its latest run. Filtering `GET /tasks?status=` only accepts these
 * five values.
 */
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const TASK_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

/** Run-level lifecycle vocabulary (docs/architecture.md §8). */
export type RunStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'needs_approval'
  | 'verifying'
  | 'publishing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export const ACTIVE_RUN_STATUSES: RunStatus[] = [
  'queued',
  'assigned',
  'running',
  'needs_approval',
  'verifying',
  'publishing',
];

export const TERMINAL_RUN_STATUSES: RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export type RunEventType =
  | 'status'
  | 'log'
  | 'tool'
  | 'artifact'
  | 'verification'
  | 'error'
  | 'approval';

export type ArtifactType = 'diff' | 'file' | 'test_result' | 'commit' | 'pull_request';

export interface ProjectDto {
  id: string;
  name: string;
  workspaceKey: string;
  defaultBranch: string;
  testCommand?: string;
  buildCommand?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProjectInput {
  name: string;
  workspaceKey: string;
  defaultBranch?: string;
  testCommand?: string | null;
  buildCommand?: string | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface RunnerDto {
  id: string;
  name: string;
  machineName?: string;
  platform?: string;
  version?: string;
  status: 'online' | 'offline';
  online: boolean;
  revoked: boolean;
  revokedAt?: string;
  lastHeartbeatAt?: string;
  createdAt?: string;
}

export interface RunnerProjectDto {
  runnerId: string;
  projectId: string;
  workspacePath: string;
  enabled: boolean;
}

export interface UpsertRunnerProjectInput {
  workspacePath: string;
  enabled?: boolean;
}

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
  cancelRequested: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunEventDto {
  id: string;
  runId: string;
  seq: number;
  type: RunEventType | 'ping';
  payload: unknown;
  createdAt: string;
}

export interface ArtifactDto {
  id: string;
  runId: string;
  type: ArtifactType | string;
  title: string;
  uri?: string;
  metadata?: unknown;
  createdAt: string;
}

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
  createdAt?: string;
  updatedAt?: string;
  runs?: RunDto[];
}

export interface CreateTaskInput {
  projectId: string;
  source?: TaskSource;
  sourceRef?: string;
  deliveryId?: string;
  intent?: TaskIntent;
  prompt: string;
  createdBy?: string;
}

export interface CreateTaskResult {
  task: TaskDto;
  run?: RunDto;
  deduplicated: boolean;
}

export const TASK_INTENTS: TaskIntent[] = ['fix', 'implement', 'review', 'test', 'general'];

export interface ListTasksQuery {
  projectId?: string;
  status?: TaskStatus;
  source?: TaskSource;
  limit?: number;
}

export interface GitHubStatusDto {
  webhookSecretConfigured: boolean;
  appConfigured: boolean;
  webhookUrl?: string;
  webhookEndpointImplemented: boolean;
}

export interface GitHubInstallationDto {
  id: string;
  account: string;
}

export interface RepositoryDto {
  id: string;
  projectId: string;
  provider: string;
  owner: string;
  repo: string;
  installationId?: string;
  createdAt?: string;
}

export interface BindRepositoryInput {
  provider?: 'github';
  owner: string;
  repo: string;
  installationId: string;
}

export interface HealthDto {
  status: string;
  runStatuses: number;
}

export type ApprovalAction = 'shell' | 'push' | 'destructive';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

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

export interface ResolveApprovalInput {
  decision: 'approved' | 'denied';
  resolvedBy?: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}
