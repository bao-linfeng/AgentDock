import { z } from 'zod';

/**
 * Control Server configuration.
 *
 * Confirmed decision (docs/architecture.md §7 TODO): the MVP has no `users`
 * table and authenticates with two independent static tokens — one for the Web
 * API and one for the Runner Gateway (docs/architecture.md §14 "Runner API 使用
 * 独立 token").
 */
export interface ServerConfig {
  databaseUrl: string;
  port: number;
  publicBaseUrl?: string;
  /** Token used by the Web console / any human-facing API client. */
  apiAuthToken: string;
  /** Bootstrap token used by the local Runner. Stored hashed in `runners`. */
  runnerToken: string;
  /** `undefined` means "reflect the request origin" (dev default). */
  corsOrigins?: string[];
  github: {
    webhookSecret?: string;
    appId?: string;
    privateKey?: string;
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Minimum length for the static tokens; short tokens are brute-forceable. */
export const MIN_TOKEN_LENGTH = 16;

/** Values shipped in env.example that must never be used as real tokens. */
const PLACEHOLDER_TOKEN_RE = /^(change[-_]?me|placeholder|todo|secret|token|test)$/i;

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const EnvSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().max(65_535).default(3100),
  PUBLIC_BASE_URL: optionalString,
  API_AUTH_TOKEN: z.string().trim().min(1, 'API_AUTH_TOKEN is required'),
  RUNNER_TOKEN: z.string().trim().min(1, 'RUNNER_TOKEN is required'),
  CORS_ORIGIN: optionalString,
  GITHUB_WEBHOOK_SECRET: optionalString,
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
});

function assertUsableToken(name: string, value: string): void {
  if (value.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(`${name} must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (PLACEHOLDER_TOKEN_RE.test(value) || value.toLowerCase().startsWith('change-me')) {
    throw new ConfigError(`${name} still holds a placeholder value; generate a real token`);
  }
}

/**
 * Parse and validate the environment. Throws `ConfigError` with an actionable
 * message instead of booting a publicly reachable server with weak tokens
 * (the server is exposed through a tunnel — see apps/server/env.example).
 */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`invalid server configuration — ${details}`);
  }

  const raw = parsed.data;
  assertUsableToken('API_AUTH_TOKEN', raw.API_AUTH_TOKEN);
  assertUsableToken('RUNNER_TOKEN', raw.RUNNER_TOKEN);
  if (raw.API_AUTH_TOKEN === raw.RUNNER_TOKEN) {
    throw new ConfigError(
      'API_AUTH_TOKEN and RUNNER_TOKEN must differ so a runner token can be revoked independently',
    );
  }

  return {
    databaseUrl: raw.DATABASE_URL,
    port: raw.PORT,
    publicBaseUrl: raw.PUBLIC_BASE_URL,
    apiAuthToken: raw.API_AUTH_TOKEN,
    runnerToken: raw.RUNNER_TOKEN,
    corsOrigins: raw.CORS_ORIGIN?.split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
    github: {
      webhookSecret: raw.GITHUB_WEBHOOK_SECRET,
      appId: raw.GITHUB_APP_ID,
      privateKey: raw.GITHUB_PRIVATE_KEY,
    },
  };
}
