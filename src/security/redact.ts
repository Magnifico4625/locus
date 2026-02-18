export const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // TODO: implement all redaction patterns from Contract 1
];

export function redact(text: string): string {
  let result = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
