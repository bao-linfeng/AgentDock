import type { CreateTaskInput, CreateTaskResult, ListTasksQuery, RunDto, TaskDto } from '../types';
import { api } from './client';

function buildQuery(query: ListTasksQuery): string {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.status) params.set('status', query.status);
  if (query.source) params.set('source', query.source);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const tasksApi = {
  list: (query: ListTasksQuery = {}) => api.get<TaskDto[]>(`/tasks${buildQuery(query)}`),
  get: (id: string) => api.get<TaskDto>(`/tasks/${id}`),
  create: (input: CreateTaskInput) => api.post<CreateTaskResult>('/tasks', input),
  listRuns: (id: string) => api.get<RunDto[]>(`/tasks/${id}/runs`),
  cancel: (id: string) => api.post<TaskDto>(`/tasks/${id}/cancel`),
};
