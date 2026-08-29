import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from '../types';
import { api } from './client';

export const projectsApi = {
  list: () => api.get<ProjectDto[]>('/projects'),
  get: (id: string) => api.get<ProjectDto>(`/projects/${id}`),
  create: (input: CreateProjectInput) => api.post<ProjectDto>('/projects', input),
  update: (id: string, input: UpdateProjectInput) =>
    api.patch<ProjectDto>(`/projects/${id}`, input),
  remove: (id: string) => api.delete<{ id: string; deleted: true }>(`/projects/${id}`),
};
