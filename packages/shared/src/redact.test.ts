import { describe, expect, it } from 'vitest';
import { containsModelKey, redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it('redacts GitHub tokens (classic + fine-grained)', () => {
    expect(redactSecrets('token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toContain(
      '[redacted:github_token]',
    );
    expect(redactSecrets('github_pat_11ABCDEFG0abcdefghijklmnop')).toContain(
      '[redacted:github_pat]',
    );
  });

  it('redacts provider API keys', () => {
    expect(redactSecrets('sk-ant-api03-abcdefghijklmnopqrstuvwx')).toContain(
      '[redacted:anthropic_key]',
    );
    expect(redactSecrets('key sk-abcdefghijklmnopqrstuvwx')).toContain('[redacted:openai_key]');
    expect(redactSecrets('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456')).toContain(
      '[redacted:google_key]',
    );
  });

  it('redacts bearer tokens and AWS keys', () => {
    expect(redactSecrets('Authorization: Bearer abcdef123456.token')).toContain(
      '[redacted:bearer]',
    );
    expect(redactSecrets('AKIAIOSFODNN7EXAMPLE')).toContain('[redacted:aws_key]');
  });

  it('redacts URL basic-auth credentials but keeps host', () => {
    const out = redactSecrets('git remote https://alice:supersecret@github.com/x/y.git');
    expect(out).toContain('[redacted:url_credentials]');
    expect(out).toContain('@github.com/x/y.git');
    expect(out).not.toContain('supersecret');
  });

  it('redacts .env-style secrets but keeps the key name', () => {
    const out = redactSecrets('API_KEY=abcdef123456\nPASSWORD: hunter2');
    expect(out).toContain('API_KEY=[redacted:env_secret]');
    expect(out).toContain('PASSWORD: [redacted:env_secret]');
    expect(out).not.toContain('hunter2');
  });

  it('redacts private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(pem)).toBe('[redacted:private_key]');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactSecrets('just a normal log line')).toBe('just a normal log line');
  });
});

describe('containsModelKey', () => {
  it('detects provider keys', () => {
    expect(containsModelKey('sk-abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(containsModelKey('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456')).toBe(true);
  });

  it('is false for non-key text (incl. runner tokens)', () => {
    expect(containsModelKey('change-me-runner-token')).toBe(false);
    expect(containsModelKey('hello world')).toBe(false);
  });
});
