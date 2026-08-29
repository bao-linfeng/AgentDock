import { describe, expect, it } from 'vitest';
import { extractToken, hashToken, tokensMatch } from './token.js';

describe('hashToken', () => {
  it('produces a stable sha256 hex digest', () => {
    expect(hashToken('runner-token')).toHaveLength(64);
    expect(hashToken('runner-token')).toBe(hashToken('runner-token'));
    expect(hashToken('runner-token')).not.toBe(hashToken('runner-token '));
  });
});

describe('tokensMatch', () => {
  it('accepts identical tokens', () => {
    expect(tokensMatch('abcdef0123456789', 'abcdef0123456789')).toBe(true);
  });

  it('rejects different tokens, including different lengths', () => {
    expect(tokensMatch('abcdef0123456789', 'abcdef012345678')).toBe(false);
    expect(tokensMatch('a', 'b')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(tokensMatch('', 'abcdef0123456789')).toBe(false);
    expect(tokensMatch('abcdef0123456789', '')).toBe(false);
  });
});

describe('extractToken', () => {
  it('reads a Bearer authorization header', () => {
    expect(extractToken({ headers: { authorization: 'Bearer secret-value' } })).toBe(
      'secret-value',
    );
    expect(extractToken({ headers: { authorization: 'bearer secret-value' } })).toBe(
      'secret-value',
    );
  });

  it('reads the x-agentdock-token header', () => {
    expect(extractToken({ headers: { 'x-agentdock-token': 'secret-value' } })).toBe('secret-value');
  });

  it('falls back to the access_token query parameter (EventSource cannot set headers)', () => {
    expect(extractToken({ query: { access_token: 'secret-value' } })).toBe('secret-value');
  });

  it('returns null when no token is present', () => {
    expect(extractToken({})).toBeNull();
    expect(extractToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
  });
});
