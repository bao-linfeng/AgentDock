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
});
