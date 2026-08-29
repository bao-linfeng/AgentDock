import type { RunnerDto, RunnerProjectDto, UpsertRunnerProjectInput } from '../types';
import { api } from './client';

export const runnersApi = {
  list: () => api.get<RunnerDto[]>('/runners'),
  get: (id: string) => api.get<RunnerDto>(`/runners/${id}`),
  revoke: (id: string) => api.post<RunnerDto>(`/runners/${id}/revoke`),
  listProjects: (id: string) => api.get<RunnerProjectDto[]>(`/runners/${id}/projects`),
  upsertProject: (id: string, projectId: string, input: UpsertRunnerProjectInput) =>
    api.put<RunnerProjectDto>(`/runners/${id}/projects/${projectId}`, input),
  removeProject: (id: string, projectId: string) =>
    api.delete<{ runnerId: string; projectId: string; deleted: true }>(
      `/runners/${id}/projects/${projectId}`,
    ),
};
