import { describe, expect, it } from 'vitest';
import { ConfigError, loadServerConfig } from './env.js';

const validEnv = {
  DATABASE_URL: 'mysql://root:pw@localhost:3306/agentdock',
  API_AUTH_TOKEN: 'web-token-0123456789abcdef',
  RUNNER_TOKEN: 'runner-token-0123456789abcdef',
};

describe('loadServerConfig', () => {
  it('parses a valid environment and defaults the port to 3100', () => {
    const config = loadServerConfig(validEnv);
    expect(config.port).toBe(3100);
    expect(config.apiAuthToken).toBe(validEnv.API_AUTH_TOKEN);
    expect(config.corsOrigins).toBeUndefined();
    expect(config.github.webhookSecret).toBeUndefined();
  });

  it('coerces PORT and splits CORS_ORIGIN', () => {
    const config = loadServerConfig({
      ...validEnv,
      PORT: '4000',
      CORS_ORIGIN: 'http://localhost:5173, https://app.example.com',
    });
    expect(config.port).toBe(4000);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadServerConfig({ ...validEnv, DATABASE_URL: '' })).toThrow(ConfigError);
  });

  it('rejects placeholder tokens shipped in env.example', () => {
    expect(() => loadServerConfig({ ...validEnv, API_AUTH_TOKEN: 'change-me-web-token' })).toThrow(
      /placeholder/,
    );
  });

  it('rejects tokens that are too short to be safe', () => {
    expect(() => loadServerConfig({ ...validEnv, RUNNER_TOKEN: 'short' })).toThrow(
      /at least 16 characters/,
    );
  });

  it('requires the web and runner tokens to differ so a runner can be revoked', () => {
    expect(() =>
      loadServerConfig({
        ...validEnv,
        RUNNER_TOKEN: validEnv.API_AUTH_TOKEN,
      }),
    ).toThrow(/must differ/);
  });

  it('treats empty optional values as undefined', () => {
    const config = loadServerConfig({ ...validEnv, GITHUB_APP_ID: '', PUBLIC_BASE_URL: '' });
    expect(config.github.appId).toBeUndefined();
    expect(config.publicBaseUrl).toBeUndefined();
  });
});
