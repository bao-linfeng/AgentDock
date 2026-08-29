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

describe('RunnerClient.claim', () => {
  it('GETs /runner/tasks/claim and returns claimed: false when idle', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ claimed: false }));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    const response = await client.claim();

    expect(response.claimed).toBe(false);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3100/runner/tasks/claim');
    expect(init.method).toBe('GET');
  });

  it('returns claimed work when available', async () => {
    const work = {
      run: {
        id: 'run_1',
        taskId: 'task_1',
        executor: 'opencode',
        status: 'assigned',
        cancelRequested: false,
      },
      task: { id: 'task_1', intent: 'fix', source: 'web', prompt: 'fix it' },
      project: {
        id: 'proj_1',
        name: 'demo',
        workspaceKey: 'demo',
        defaultBranch: 'main',
        workspacePath: '/tmp/demo',
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ claimed: true, work }));
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    const response = await client.claim();
    expect(response.claimed).toBe(true);
    expect(response.work?.run.id).toBe('run_1');
  });
});

describe('RunnerClient.appendEvent', () => {
  it('posts the event type and payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'evt_1',
        runId: 'run_1',
        seq: 1,
        type: 'log',
        payload: {},
        createdAt: 'now',
      }),
    );
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    await client.appendEvent('run_1', 'log', { message: 'hi' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe('http://localhost:3100/runner/runs/run_1/events');
    expect(JSON.parse(init.body)).toEqual({ type: 'log', payload: { message: 'hi' } });
  });
});

describe('RunnerClient.runHeartbeat', () => {
  it('posts to /runner/runs/:id/heartbeat and returns cancelRequested', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ runId: 'run_1', status: 'running', cancelRequested: true }),
      );
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    const response = await client.runHeartbeat('run_1', 'progressing');

    expect(response.cancelRequested).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe('http://localhost:3100/runner/runs/run_1/heartbeat');
    expect(JSON.parse(init.body)).toEqual({ note: 'progressing' });
  });
});

describe('RunnerClient.complete', () => {
  it('posts the terminal status and artifacts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 'run_1',
        taskId: 'task_1',
        executor: 'opencode',
        status: 'succeeded',
        cancelRequested: false,
      }),
    );
    const client = new RunnerClient({
      serverUrl: 'http://localhost:3100',
      runnerToken: 'tok',
      fetchImpl,
    });

    await client.complete('run_1', { status: 'succeeded' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe('http://localhost:3100/runner/runs/run_1/complete');
    expect(JSON.parse(init.body)).toEqual({ status: 'succeeded', artifacts: [] });
  });
});
