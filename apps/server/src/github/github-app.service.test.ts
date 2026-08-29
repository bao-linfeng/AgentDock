import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../config/env.js';
import { GitHubAppService } from './github-app.service.js';

function config(overrides: Partial<ServerConfig['github']> = {}): ServerConfig {
  return {
    databaseUrl: 'mysql://localhost/db',
    port: 3100,
    apiAuthToken: 'a'.repeat(20),
    runnerToken: 'b'.repeat(20),
    github: { appId: 'app_1', privateKey: 'pem', ...overrides },
  };
}

describe('GitHubAppService.isConfigured', () => {
  it('is false when appId/privateKey are missing', () => {
    const service = new GitHubAppService(config({ appId: undefined, privateKey: undefined }));
    expect(service.isConfigured()).toBe(false);
  });

  it('is true once both appId and privateKey are set', () => {
    const service = new GitHubAppService(config());
    expect(service.isConfigured()).toBe(true);
  });
});

describe('GitHubAppService installation access', () => {
  it('throws ServiceUnavailableException when the App is not configured', async () => {
    const service = new GitHubAppService(config({ appId: undefined, privateKey: undefined }));
    await expect(service.installationOctokit('123')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lazily constructs the App once and reuses it across calls', async () => {
    const fakeOctokit = { fake: true };
    const getInstallationOctokit = vi.fn().mockResolvedValue(fakeOctokit);
    const appFactory = vi.fn().mockReturnValue({
      octokit: { fake: 'app-level' },
      getInstallationOctokit,
    });
    const service = new GitHubAppService(config(), appFactory as never);

    const first = await service.installationOctokit('123');
    const second = await service.installationOctokit('456');

    expect(appFactory).toHaveBeenCalledTimes(1);
    expect(appFactory).toHaveBeenCalledWith({ appId: 'app_1', privateKey: 'pem' });
    expect(getInstallationOctokit).toHaveBeenNthCalledWith(1, 123);
    expect(getInstallationOctokit).toHaveBeenNthCalledWith(2, 456);
    expect(first).toBe(fakeOctokit);
    expect(second).toBe(fakeOctokit);
  });

  it('paginates listInstallationRepositories into a flat owner/repo list', async () => {
    async function* iterator() {
      yield { data: [{ owner: { login: 'acme' }, name: 'repo-a' }] };
      yield { data: [{ owner: { login: 'acme' }, name: 'repo-b' }] };
    }
    const listReposAccessibleToInstallation = vi.fn();
    const fakeOctokit = {
      rest: { apps: { listReposAccessibleToInstallation } },
      paginate: { iterator: vi.fn().mockReturnValue(iterator()) },
    };
    const appFactory = vi.fn().mockReturnValue({
      octokit: {},
      getInstallationOctokit: vi.fn().mockResolvedValue(fakeOctokit),
    });
    const service = new GitHubAppService(config(), appFactory as never);

    const repos = await service.listInstallationRepositories('123');

    expect(repos).toEqual([
      { owner: 'acme', repo: 'repo-a' },
      { owner: 'acme', repo: 'repo-b' },
    ]);
    expect(fakeOctokit.paginate.iterator).toHaveBeenCalledWith(listReposAccessibleToInstallation, {
      per_page: 100,
    });
  });
});
