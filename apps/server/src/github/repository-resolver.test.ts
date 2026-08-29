import type { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { resolveTargetRepository } from './repository-resolver.js';

function fakeLogger(): Logger {
  return { warn: vi.fn() } as unknown as Logger;
}

describe('resolveTargetRepository', () => {
  const repos = [
    { owner: 'acme', repo: 'frontend', installationId: 'i1' },
    { owner: 'acme', repo: 'backend', installationId: 'i2' },
  ];

  it('matches the repository named by callbackRepo, even with multiple bound repositories', () => {
    const logger = fakeLogger();
    const result = resolveTargetRepository(repos, 'acme/backend', logger, 'ctx');
    expect(result).toBe(repos[1]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when callbackRepo does not match any bound repository', () => {
    const logger = fakeLogger();
    const result = resolveTargetRepository(repos, 'acme/other', logger, 'ctx');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('falls back to the single bound repository when there is no callbackRepo', () => {
    const logger = fakeLogger();
    const single = [repos[0]];
    const result = resolveTargetRepository(single, null, logger, 'ctx');
    expect(result).toBe(single[0]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when there is no callbackRepo and more than one bound repository', () => {
    const logger = fakeLogger();
    const result = resolveTargetRepository(repos, undefined, logger, 'ctx');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('returns null without warning when there is no callbackRepo and no bound repository', () => {
    const logger = fakeLogger();
    const result = resolveTargetRepository([], null, logger, 'ctx');
    expect(result).toBeNull();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
