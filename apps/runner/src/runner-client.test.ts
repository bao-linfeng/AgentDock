import { describe, expect, it, vi } from 'vitest';
import { RunnerApiError, RunnerClient, RunnerTokenRevokedError } from './runner-client.js';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RunnerClient.register', () => {
  it('posts to /runner/register with the bearer token and reports platform', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'rnr_1',
        name: 'dev-box',
        status: 'online',
        online: true,
        revoked: false,
      }),
    );
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    const dto = await client.register({ name: 'dev-box', platform: 'win32' });

    expect(dto.id).toBe('rnr_1');
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://localhost:3100/runner/register');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'dev-box',
      machineName: undefined,
      platform: 'win32',
      version: undefined,
    });
  });

  it('throws RunnerTokenRevokedError on a 401 revoked response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('runner token has been revoked', { status: 401 }));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    await expect(client.register({ name: 'dev-box' })).rejects.toBeInstanceOf(
      RunnerTokenRevokedError,
    );
  });

  it('throws a generic RunnerApiError on other failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    await expect(client.register({ name: 'dev-box' })).rejects.toBeInstanceOf(RunnerApiError);
  });

  it('strips a trailing slash from serverUrl', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'rnr_1',
        name: 'dev-box',
        status: 'online',
        online: true,
        revoked: false,
      }),
    );
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100/',
      runnerToken: 'tok',
      fetchImpl,
    });
    await client.register({ name: 'dev-box' });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://localhost:3100/runner/register');
  });
});

describe('RunnerClient.heartbeat', () => {
  it('posts to /runner/heartbeat and returns active runs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ runnerId: 'rnr_1', activeRuns: [] }));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    const dto = await client.heartbeat();
    expect(dto.runnerId).toBe('rnr_1');
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('wraps a network error as RunnerApiError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });
    await expect(client.heartbeat()).rejects.toBeInstanceOf(RunnerApiError);
  });
});
