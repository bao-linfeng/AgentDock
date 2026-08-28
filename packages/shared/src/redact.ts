/**
 * Secret redaction for log lines and run events.
 *
 * NOTE: This is deliberately part of `shared` so the log channel can redact
 * from day one (Milestone 4), rather than waiting for M9. See
 * docs/tasks.md T9.4 review note.
 */
const PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { label: 'openai_key', re: /sk-[A-Za-z0-9]{20,}/g },
  { label: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{10,}/g },
  { label: 'aws_key', re: /AKIA[0-9A-Z]{16}/g },
  // Generic `KEY=value` / `TOKEN: value` style secrets from .env dumps.
  {
    label: 'env_secret',
    re: /((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*)(\S+)/gi,
  },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { label, re } of PATTERNS) {
    out = out.replace(re, (_match, prefix?: string) =>
      prefix ? `${prefix}[redacted:${label}]` : `[redacted:${label}]`,
    );
  }
  return out;
}
