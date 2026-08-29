import { useAuthStore } from '../stores/auth';
import type { ApiErrorBody } from '../types';

/**
 * Thin fetch wrapper for the Control Server API.
 *
 * - Base path is `/api` (Vite dev proxy strips it and forwards to the server,
 *   see apps/web/vite.config.ts; in production this should be reverse-proxied
 *   the same way).
 * - Auth: `Authorization: Bearer <API_AUTH_TOKEN>` header (apps/server/src/auth/token.ts).
 *   The query-string `?access_token=` form is reserved for SSE (EventSource
 *   cannot set custom headers) and is handled directly by useRunEvents.ts.
 */
export class ApiError extends Error {
  status: number;
  body?: ApiErrorBody;

  constructor(status: number, message: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const BASE_URL = '/api';

function authHeaders(): HeadersInit {
  const token = useAuthStore().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody | undefined> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await parseErrorBody(res);
    const message = body?.message ?? body?.error ?? `request failed with status ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Builds the API base URL for a direct (non-fetch) consumer, e.g. EventSource. */
export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}
