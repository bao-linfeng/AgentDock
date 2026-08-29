import type { ApprovalDto, ResolveApprovalInput } from '../types';
import { api } from './client';

/** Approval gate (docs/tasks.md T8.3, #37): shell / push / destructive actions. */
export const approvalsApi = {
  listPending: () => api.get<ApprovalDto[]>('/approvals/pending'),
  listForRun: (runId: string) => api.get<ApprovalDto[]>(`/runs/${runId}/approvals`),
  get: (id: string) => api.get<ApprovalDto>(`/approvals/${id}`),
  resolve: (id: string, input: ResolveApprovalInput) =>
    api.post<ApprovalDto>(`/approvals/${id}/resolve`, input),
};
