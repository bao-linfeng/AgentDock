import type { ArtifactDto, RunDto, RunEventDto } from '../types';
import { api } from './client';

export const runsApi = {
  get: (id: string) => api.get<RunDto>(`/runs/${id}`),
  listEvents: (id: string, afterSeq?: number, limit = 500) => {
    const params = new URLSearchParams();
    if (afterSeq !== undefined) params.set('afterSeq', String(afterSeq));
    params.set('limit', String(limit));
    return api.get<RunEventDto[]>(`/runs/${id}/events?${params.toString()}`);
  },
  listArtifacts: (id: string) => api.get<ArtifactDto[]>(`/runs/${id}/artifacts`),
  cancel: (id: string) => api.post<RunDto>(`/runs/${id}/cancel`),
  /** Retry a failed run as a new run, keeping the failed run's history (T9.2 / #39). */
  retry: (id: string) => api.post<RunDto>(`/runs/${id}/retry`),
};
