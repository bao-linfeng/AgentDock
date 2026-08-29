import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook `X-Hub-Signature-256` header (T6.2).
 *
 * GitHub signs the raw request body with HMAC-SHA256 using the webhook
 * secret and sends it as `sha256=<hex>`. Comparison must be constant-time to
 * avoid leaking the expected signature through timing side channels.
 */
export function verifyGitHubSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;

  const expectedHex = signatureHeader.slice(prefix.length).trim();
  if (expectedHex.length === 0) return false;

  const digest = createHmac('sha256', secret).update(rawBody).digest();

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  // Reject malformed hex early — timingSafeEqual throws on length mismatch.
  if (expected.length !== digest.length) return false;

  return timingSafeEqual(digest, expected);
}
