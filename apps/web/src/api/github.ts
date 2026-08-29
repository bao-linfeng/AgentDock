import type { GitHubInstallationDto, GitHubStatusDto } from '../types';
import { api } from './client';

export const githubApi = {
  status: () => api.get<GitHubStatusDto>('/github/status'),
  installations: () => api.get<GitHubInstallationDto[]>('/github/installations'),
};
