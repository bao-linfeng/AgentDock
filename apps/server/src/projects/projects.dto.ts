import { type EvidenceRulesOverride, EvidenceRulesOverrideSchema } from '@agentdock/protocol';
import { z } from 'zod';

/** A shell command configured per project (test / build). `null` clears it. */
const commandField = z.string().trim().min(1).max(500).nullish();

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /**
   * Logical project key shared by server and runners. `runner_projects.workspacePath`
   * holds the machine-local absolute path (resolves the architecture §7 open
   * question: `workspaceKey` is logical, `workspacePath` is physical & per-runner).
   */
  workspaceKey: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._-]+$/, 'workspaceKey may only contain letters, digits, . _ -'),
  defaultBranch: z.string().trim().min(1).max(200).default('main'),
  testCommand: commandField,
  buildCommand: commandField,
  /**
   * Per-intent evidence-rule overrides (docs/tasks.md T8.4, #60). `null` clears
   * the override and falls back to `DEFAULT_EVIDENCE_RULES`; `undefined` leaves
   * it untouched on update.
   */
  evidenceRules: EvidenceRulesOverrideSchema.nullish(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'at least one field must be provided' },
);
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  workspaceKey: string;
  defaultBranch: string;
  testCommand?: string;
  buildCommand?: string;
  /** Per-intent evidence overrides; absent means "use the defaults" (#60). */
  evidenceRules?: EvidenceRulesOverride;
  createdAt?: string;
  updatedAt?: string;
}
