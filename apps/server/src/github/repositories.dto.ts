import { z } from 'zod';

/** GitHub `owner`/`repo` path segments — same charset GitHub itself allows. */
const ghSegment = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'must only contain letters, digits, . _ -');

export const BindRepositorySchema = z.object({
  provider: z.literal('github').default('github'),
  owner: ghSegment,
  repo: ghSegment,
  /** GitHub App installation id that was granted access to this repository. */
  installationId: z.string().trim().min(1).max(64),
});
export type BindRepositoryInput = z.infer<typeof BindRepositorySchema>;

export interface RepositoryDto {
  id: string;
  projectId: string;
  provider: string;
  owner: string;
  repo: string;
  installationId?: string;
  createdAt?: string;
}
