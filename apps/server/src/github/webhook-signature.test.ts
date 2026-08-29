import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGitHubSignature } from './webhook-signature.js';

const secret = 'test-webhook-secret';

function sign(body: string, withSecret = secret): string {
  return `sha256=${createHmac('sha256', withSecret).update(body).digest('hex')}`;
}

describe('verifyGitHubSignature', () => {
  it('accepts a signature computed over the exact raw body', () => {
    const body = JSON.stringify({ hello: 'world' });
    expect(verifyGitHubSignature(body, sign(body), secret)).toBe(true);
  });

  it('accepts a Buffer body (as delivered by rawBody)', () => {
    const body = Buffer.from(JSON.stringify({ a: 1 }));
    expect(verifyGitHubSignature(body, sign(body.toString()), secret)).toBe(true);
  });

  it('rejects when the secret does not match', () => {
    const body = JSON.stringify({ hello: 'world' });
    expect(verifyGitHubSignature(body, sign(body, 'wrong-secret'), secret)).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const body = JSON.stringify({ hello: 'world' });
    const signature = sign(body);
    expect(verifyGitHubSignature(JSON.stringify({ hello: 'tampered' }), signature, secret)).toBe(
      false,
    );
  });

  it('rejects a missing signature header', () => {
    expect(verifyGitHubSignature('{}', undefined, secret)).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    expect(verifyGitHubSignature('{}', 'abcdef', secret)).toBe(false);
  });

  it('rejects malformed hex without throwing', () => {
    expect(verifyGitHubSignature('{}', 'sha256=not-hex-!!', secret)).toBe(false);
  });

  it('rejects a signature of the wrong length', () => {
    expect(verifyGitHubSignature('{}', 'sha256=ab', secret)).toBe(false);
  });
});
