import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

/** Minimal fake `ChildProcess` good enough for `launchAcpProcess`'s wiring. */
function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}

describe('launchAcpProcess', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('spawns with shell: true on win32 (required for .cmd/.bat shims — see EINVAL/ENOENT on Windows)', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    spawnMock.mockReturnValue(createFakeChild());

    const { launchAcpProcess } = await import('./acp-client.js');
    launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({ shell: true }),
    );
  });

  it('spawns without a shell on non-Windows platforms', async () => {
    vi.stubGlobal('process', { ...process, platform: 'linux', env: process.env });
    spawnMock.mockReturnValue(createFakeChild());

    const { launchAcpProcess } = await import('./acp-client.js');
    launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('normalizes a Path-only env into PATH on win32 (#71)', async () => {
    const { PATH: _omit, ...envWithoutPath } = process.env;
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      env: { ...envWithoutPath, Path: 'C:\\nvm4w\\nodejs' },
    });
    spawnMock.mockReturnValue(createFakeChild());

    const { launchAcpProcess } = await import('./acp-client.js');
    launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({ env: expect.objectContaining({ PATH: 'C:\\nvm4w\\nodejs' }) }),
    );
  });

  it('leaves env untouched when PATH is already present', async () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      env: { ...process.env, PATH: 'C:\\already-correct', Path: 'C:\\ignored' },
    });
    spawnMock.mockReturnValue(createFakeChild());

    const { launchAcpProcess } = await import('./acp-client.js');
    launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({ env: expect.objectContaining({ PATH: 'C:\\already-correct' }) }),
    );
  });

  it('does not normalize PATH casing on non-Windows platforms', async () => {
    const { PATH: _omit, ...envWithoutPath } = process.env;
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      env: { ...envWithoutPath, Path: '/should/not/be/used' },
    });
    spawnMock.mockReturnValue(createFakeChild());

    const { launchAcpProcess } = await import('./acp-client.js');
    launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      ['acp'],
      expect.objectContaining({ env: expect.not.objectContaining({ PATH: expect.anything() }) }),
    );
  });

  it('surfaces a spawn failure on handle.spawnError instead of throwing (#71)', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', env: process.env });
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);

    const { launchAcpProcess } = await import('./acp-client.js');
    const handle = launchAcpProcess({ command: 'opencode', cwd: process.cwd() });

    expect(handle.spawnError).toBeUndefined();
    const error = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' });
    child.emit('error', error);

    expect(handle.spawnError).toBe(error);
    await expect(handle.exited).resolves.toEqual({ code: null, signal: null });
    await expect(handle.kill()).resolves.toBeUndefined();
  });
});
