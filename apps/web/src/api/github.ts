import type { GitHubStatusDto } from '../types';
import { api } from './client';

export const githubApi = {
  status: () => api.get<GitHubStatusDto>('/github/status'),
};
