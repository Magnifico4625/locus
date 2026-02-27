// Content redaction patterns (Contract 1 — Security Layer 2)
//
// Order matters: specific patterns first, generic KEY=VALUE last.
// All patterns use /g flag for global replacement.
// False-positive protection: generic pattern requires 8+ char values
// and only matches KEY=VALUE or KEY: VALUE assignment syntax.

export const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Private key blocks (multiline — must run first)
  {
    pattern: /-----BEGIN [\w\s]*PRIVATE KEY-----[\s\S]*?-----END [\w\s]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },

  // Known-prefix API keys
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})/g, replacement: 'sk-[REDACTED]' },
  { pattern: /\b(pk-[a-zA-Z0-9]{20,})/g, replacement: 'pk-[REDACTED]' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})/g, replacement: 'ghp_[REDACTED]' },
  { pattern: /\b(gho_[a-zA-Z0-9]{36,})/g, replacement: 'gho_[REDACTED]' },
  {
    pattern: /\b(glpat-[a-zA-Z0-9\-_]{20,})/g,
    replacement: 'glpat-[REDACTED]',
  },
  { pattern: /\b(xox[bpas]-[a-zA-Z0-9-]+)/g, replacement: 'xox_-[REDACTED]' },

  // AWS access keys (AKIA + 16 uppercase alphanumeric)
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, replacement: 'AKIA[REDACTED]' },

  // Connection strings (protocol://...)
  {
    pattern: /((?:postgres|mysql|mongodb|redis|amqp):\/\/)[^\s'"]+/gi,
    replacement: '$1[REDACTED]',
  },

  // Bearer tokens (20+ chars after "Bearer ")
  {
    pattern: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi,
    replacement: '$1[REDACTED]',
  },

  // Generic KEY=VALUE (requires 8+ char value to avoid false positives)
  {
    pattern:
      /\b([A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*)\s*[=:]\s*['"]?(\S{8,})['"]?/gi,
    replacement: '$1=[REDACTED]',
  },
];

export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
