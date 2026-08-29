import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  RunnerConfigSchema,
  assertNoEmbeddedModelKeys,
  loadConfig,
  validateProjects,
} from './config.js';

const execFileAsync = promisify(execFile);

describe('RunnerConfigSchema', () => {
  it('applies defaults', () => {
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
    });
    expect(cfg.projects).toEqual({});
  });

  it('defaults a project to push disabled (commit-only behavior)', () => {
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      projects: { proj_1: { workspacePath: '/tmp/repo' } },
    });
    expect(cfg.projects.proj_1?.push).toEqual({
      enabled: false,
      remote: 'origin',
      protectedBranches: [],
    });
  });

  it('accepts an explicit push configuration', () => {
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      projects: {
        proj_1: {
          workspacePath: '/tmp/repo',
          push: { enabled: true, remote: 'upstream', protectedBranches: ['release'] },
        },
      },
    });
    expect(cfg.projects.proj_1?.push).toEqual({
      enabled: true,
      remote: 'upstream',
      protectedBranches: ['release'],
    });
  });

  it('rejects a bad server url', () => {
    expect(() =>
      RunnerConfigSchema.parse({ serverUrl: 'not-a-url', runnerToken: 't', runnerName: 'r' }),
    ).toThrow();
  });
});

describe('assertNoEmbeddedModelKeys', () => {
  it('throws when a provider key is present', () => {
    expect(() => assertNoEmbeddedModelKeys('{"key":"sk-abcdefghijklmnopqrstuvwx"}')).toThrow(
      ConfigError,
    );
  });

  it('accepts a config without model keys', () => {
    expect(() =>
      assertNoEmbeddedModelKeys('{"runnerToken":"change-me-runner-token"}'),
    ).not.toThrow();
  });
});

describe('validateProjects', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentdock-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('flags a missing path', async () => {
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      projects: { proj_1: { workspacePath: join(dir, 'nope') } },
    });
    const issues = await validateProjects(cfg);
    expect(issues.some((i) => i.message.includes('does not exist'))).toBe(true);
  });

  it('flags a non-git directory', async () => {
    const repo = join(dir, 'plain');
    await mkdir(repo);
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      projects: { proj_1: { workspacePath: repo } },
    });
    const issues = await validateProjects(cfg);
    expect(issues.some((i) => i.message.includes('not a git repository'))).toBe(true);
  });

  it('accepts a git repo contained under allowedRoots', async () => {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repo });
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      allowedRoots: [dir],
      projects: { proj_1: { workspacePath: repo } },
    });
    expect(await validateProjects(cfg)).toEqual([]);
  });

  it('flags a path escaping allowedRoots', async () => {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    await execFileAsync('git', ['init', '--quiet'], { cwd: repo });
    const cfg = RunnerConfigSchema.parse({
      serverUrl: 'http://localhost:3100',
      runnerToken: 't',
      runnerName: 'r',
      allowedRoots: [join(dir, 'somewhere-else')],
      projects: { proj_1: { workspacePath: repo } },
    });
    const issues = await validateProjects(cfg);
    expect(issues.some((i) => i.message.includes('escapes allowedRoots'))).toBe(true);
  });
});

describe('loadConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentdock-cfg-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a valid config and rejects one with a model key', async () => {
    const good = join(dir, 'good.json');
    await writeFile(
      good,
      JSON.stringify({ serverUrl: 'http://localhost:3100', runnerToken: 't', runnerName: 'r' }),
    );
    const cfg = await loadConfig(good);
    expect(cfg.runnerName).toBe('r');

    const bad = join(dir, 'bad.json');
    await writeFile(
      bad,
      JSON.stringify({
        serverUrl: 'http://localhost:3100',
        runnerToken: 't',
        runnerName: 'r',
        openaiKey: 'sk-abcdefghijklmnopqrstuvwx',
      }),
    );
    await expect(loadConfig(bad)).rejects.toBeInstanceOf(ConfigError);
  });
});
