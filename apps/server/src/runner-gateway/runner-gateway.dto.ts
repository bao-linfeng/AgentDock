import type { ApprovalAction, ApprovalStatus, TaskIntent, TaskSource } from '@agentdock/protocol';
import type { RunDto } from '../runs/runs.dto.js';

/** Everything a runner needs to execute one run, resolved server-side. */
export interface ClaimedWorkDto {
  run: RunDto;
  task: {
    id: string;
    intent: TaskIntent;
    source: TaskSource;
    sourceRef?: string;
    prompt: string;
  };
  project: {
    id: string;
    name: string;
    workspaceKey: string;
    defaultBranch: string;
    testCommand?: string;
    buildCommand?: string;
    /** Runner-local checkout path from `runner_projects`. */
    workspacePath: string;
  };
}

export interface ClaimResponseDto {
  claimed: boolean;
  work?: ClaimedWorkDto;
}

/** Status of the approval a runner is currently blocked on, if any. */
export interface PendingApprovalStatusDto {
  approvalId: string;
  action: ApprovalAction;
  status: ApprovalStatus;
}

/** Heartbeat response — this is the cancellation *and* approval down-channel (architecture §9). */
export interface RunHeartbeatResponseDto {
  runId: string;
  status: string;
  cancelRequested: boolean;
  /**
   * Every approval this run has pending, plus any resolved in roughly the
   * last hour (docs/tasks.md T8.3, #37). A run can have more than one
   * approval in flight at once — e.g. concurrent ACP shell/tool-call
   * permission requests — so callers must match on `approvalId` rather than
   * assume there is only ever one. Recently-resolved approvals are included
   * so a poller waiting on a specific `approvalId` can observe its decision
   * (a `status: 'pending'`-only filter would never show the transition out
   * of `pending`).
   */
  approvals: PendingApprovalStatusDto[];
}

export interface RunnerHeartbeatResponseDto {
  runnerId: string;
  /** Runs currently assigned to this runner, with their cancellation flags. */
  activeRuns: { runId: string; status: string; cancelRequested: boolean }[];
}
