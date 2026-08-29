import { z } from 'zod';

export const RegisterRunnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  machineName: z.string().trim().min(1).max(120).optional(),
  platform: z.string().trim().min(1).max(60).optional(),
  version: z.string().trim().min(1).max(60).optional(),
});
export type RegisterRunnerInput = z.infer<typeof RegisterRunnerSchema>;

export const UpsertRunnerProjectSchema = z.object({
  /**
   * Absolute path of the project checkout **on the runner machine**. The runner
   * re-validates existence / git repo / root containment locally
   * (docs/architecture.md §14, apps/runner `validateProjects`).
   */
  workspacePath: z.string().trim().min(1).max(1000),
  enabled: z.boolean().default(true),
});
export type UpsertRunnerProjectInput = z.infer<typeof UpsertRunnerProjectSchema>;

export interface RunnerDto {
  id: string;
  name: string;
  machineName?: string;
  platform?: string;
  version?: string;
  status: 'online' | 'offline';
  /** Derived from `lastHeartbeatAt` rather than the stored status column. */
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
