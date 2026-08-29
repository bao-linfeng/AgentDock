/**
 * Secret redaction for log lines and run events.
 *
 * NOTE: This lives in `shared` so the log channel can redact from day one
 * (Milestone 4), rather than waiting for M9. See docs/tasks.md T9.4 review note.
 * Redaction is defense-in-depth — secrets must never reach a RunEvent in the
 * first place (docs/architecture.md §14).
 */
interface Pattern {
  label: string;
  re: RegExp;
}

/** Provider / model API keys that must never appear in the runner config. */
const PROVIDER_KEY_PATTERNS: Pattern[] = [
  { label: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: 'openai_key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { label: 'google_key', re: /AIza[0-9A-Za-z_-]{35}/g },
];

/** Tokens/credentials whose entire match should be redacted. */
const TOKEN_PATTERNS: Pattern[] = [
  { label: 'github_pat', re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { label: 'github_token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { label: 'slack_token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'aws_key', re: /AKIA[0-9A-Z]{16}/g },
  { label: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{10,}/g },
  {
    label: 'private_key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
];

/** Whole-match patterns (anthropic before openai so the more specific wins). */
const WHOLE_MATCH_PATTERNS: Pattern[] = [...PROVIDER_KEY_PATTERNS, ...TOKEN_PATTERNS];

/** URL basic-auth credentials: scheme://user:pass@host (preserve prefix). */
const URL_CREDENTIALS_RE = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi;

/** Generic `KEY=value` / `TOKEN: value` .env-style secrets (preserve the key). */
const ENV_SECRET_RE =
  /((?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*)("?)([^\s"]+)\2/gi;

/** Replace known secret shapes in a string with `[redacted:<label>]`. */
export function redactSecrets(input: string): string {
  let out = input;
  for (const { label, re } of WHOLE_MATCH_PATTERNS) {
    out = out.replace(re, `[redacted:${label}]`);
  }
  out = out.replace(URL_CREDENTIALS_RE, '$1[redacted:url_credentials]@');
  out = out.replace(ENV_SECRET_RE, (_m, prefix: string, quote: string) => {
    return `${prefix}${quote}[redacted:env_secret]${quote}`;
  });
  return out;
}

/**
 * True when the text contains something that looks like a model/provider API
 * key. Used to reject a runner config that embeds model keys — those belong in
 * the user's OpenCode config, never here (docs/requirements.md §7).
 */
export function containsModelKey(text: string): boolean {
  return PROVIDER_KEY_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}
