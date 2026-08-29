import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * SHA-256 hash of a bearer token. Only the hash is persisted (`runners.token_hash`),
 * so a database dump never leaks a usable runner credential.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time token comparison. Hashing both sides first keeps the compared
 * buffers equal in length, so no information leaks through the length check.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  if (provided.length === 0 || expected.length === 0) return false;
  const a = Buffer.from(hashToken(provided), 'hex');
  const b = Buffer.from(hashToken(expected), 'hex');
  return timingSafeEqual(a, b);
}

export interface TokenCarrier {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/**
 * Extract a token from `Authorization: Bearer ...`, the `x-agentdock-token`
 * header, or an `access_token` query parameter.
 *
 * The query parameter exists because the browser `EventSource` API cannot send
 * custom headers (used by the SSE stream in EventsController). It is accepted
 * for every Web API route for consistency; tokens in URLs can end up in server
 * logs, so header auth is preferred wherever possible.
 */
export function extractToken(request: TokenCarrier): string | null {
  const headers = request.headers ?? {};
  const authorization = headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }

  const custom = headers['x-agentdock-token'];
  if (typeof custom === 'string' && custom.trim().length > 0) return custom.trim();

  const queryToken = request.query?.access_token;
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) return queryToken.trim();

  return null;
}
