import type { BindRepositoryInput, RepositoryDto } from '../types';
import { api } from './client';

export const repositoriesApi = {
  list: (projectId: string) => api.get<RepositoryDto[]>(`/projects/${projectId}/repositories`),
  bind: (projectId: string, input: BindRepositoryInput) =>
    api.post<RepositoryDto>(`/projects/${projectId}/repositories`, input),
  unbind: (projectId: string, repositoryId: string) =>
    api.delete<{ id: string; deleted: true }>(
      `/projects/${projectId}/repositories/${repositoryId}`,
    ),
};
