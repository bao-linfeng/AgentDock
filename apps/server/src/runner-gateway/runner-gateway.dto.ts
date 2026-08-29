import type { TaskIntent, TaskSource } from '@agentdock/protocol';
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

/** Heartbeat response — this is the cancellation down-channel (architecture §9). */
export interface RunHeartbeatResponseDto {
  runId: string;
  status: string;
  cancelRequested: boolean;
}

export interface RunnerHeartbeatResponseDto {
  runnerId: string;
  /** Runs currently assigned to this runner, with their cancellation flags. */
  activeRuns: { runId: string; status: string; cancelRequested: boolean }[];
}
