import { describe, expect, it, vi } from 'vitest';
import { HeartbeatLoop } from './heartbeat-loop.js';
import { RunnerApiError, type RunnerClient, RunnerTokenRevokedError } from './runner-client.js';

function fakeClient(overrides: Partial<RunnerClient> = {}): RunnerClient {
  return {
    register: vi.fn().mockResolvedValue({
      id: 'rnr_1',
      name: 'r',
      status: 'online',
      online: true,
      revoked: false,
    }),
    heartbeat: vi.fn().mockResolvedValue({ runnerId: 'rnr_1', activeRuns: [] }),
    ...overrides,
  } as unknown as RunnerClient;
}

describe('HeartbeatLoop.start', () => {
  it('registers, flips to online, and schedules the interval', async () => {
    const client = fakeClient();
    const setIntervalImpl = vi
      .fn()
      .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
    const onStateChange = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      onStateChange,
      setIntervalImpl,
      clearIntervalImpl: vi.fn(),
    });

    await loop.start();

    expect(client.register).toHaveBeenCalledWith({
      name: 'dev-box',
      machineName: undefined,
      version: undefined,
    });
    expect(loop.currentState).toBe('online');
    expect(onStateChange).toHaveBeenCalledWith('online');
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it('propagates a registration failure without scheduling the interval', async () => {
    const client = fakeClient({ register: vi.fn().mockRejectedValue(new RunnerApiError('boom')) });
    const setIntervalImpl = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      setIntervalImpl,
      clearIntervalImpl: vi.fn(),
    });

    await expect(loop.start()).rejects.toBeInstanceOf(RunnerApiError);
    expect(setIntervalImpl).not.toHaveBeenCalled();
  });
});

describe('HeartbeatLoop.tick', () => {
  it('flips to offline and calls onError when a heartbeat fails', async () => {
    const client = fakeClient({ heartbeat: vi.fn().mockRejectedValue(new RunnerApiError('down')) });
    const onStateChange = vi.fn();
    const onError = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      onStateChange,
      onError,
      setIntervalImpl: vi.fn().mockReturnValue(1 as unknown as ReturnType<typeof setInterval>),
      clearIntervalImpl: vi.fn(),
    });
    await loop.start();
    onStateChange.mockClear();

    await loop.tick();

    expect(loop.currentState).toBe('offline');
    expect(onStateChange).toHaveBeenCalledWith('offline');
    expect(onError).toHaveBeenCalled();
  });

  it('recovers to online on the next successful heartbeat', async () => {
    const heartbeat = vi
      .fn()
      .mockRejectedValueOnce(new RunnerApiError('down'))
      .mockResolvedValue({ runnerId: 'rnr_1', activeRuns: [] });
    const client = fakeClient({ heartbeat });
    const onStateChange = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      onStateChange,
      setIntervalImpl: vi.fn().mockReturnValue(1 as unknown as ReturnType<typeof setInterval>),
      clearIntervalImpl: vi.fn(),
    });
    await loop.start();
    onStateChange.mockClear();

    await loop.tick(); // fails -> offline
    await loop.tick(); // succeeds -> online

    expect(onStateChange.mock.calls.map((c) => c[0])).toEqual(['offline', 'online']);
  });

  it('stops the loop and calls onRevoked when the token is revoked', async () => {
    const client = fakeClient({
      heartbeat: vi.fn().mockRejectedValue(new RunnerTokenRevokedError('revoked')),
    });
    const clearIntervalImpl = vi.fn();
    const onRevoked = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      onRevoked,
      setIntervalImpl: vi.fn().mockReturnValue(1 as unknown as ReturnType<typeof setInterval>),
      clearIntervalImpl,
    });
    await loop.start();

    await loop.tick();

    expect(onRevoked).toHaveBeenCalled();
    expect(clearIntervalImpl).toHaveBeenCalledWith(1);

    // Further ticks are no-ops once stopped.
    const heartbeatCallsBefore = (client.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length;
    await loop.tick();
    expect((client.heartbeat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      heartbeatCallsBefore,
    );
  });
});

describe('HeartbeatLoop.stop', () => {
  it('clears the interval', async () => {
    const client = fakeClient();
    const clearIntervalImpl = vi.fn();
    const loop = new HeartbeatLoop({
      client,
      intervalMs: 15_000,
      runnerName: 'dev-box',
      setIntervalImpl: vi.fn().mockReturnValue(42 as unknown as ReturnType<typeof setInterval>),
      clearIntervalImpl,
    });
    await loop.start();

    loop.stop();

    expect(clearIntervalImpl).toHaveBeenCalledWith(42);
  });
});
