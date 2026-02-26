export type StripState =
  | 'CODE'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT'
  | 'SQ_STRING'
  | 'DQ_STRING'
  | 'TEMPLATE';

/**
 * Strip non-structural content from source code.
 *
 * Removes string contents, template literal text, and comments while
 * preserving the structural skeleton: identifiers, keywords, braces,
 * operators, and code inside template expressions (`${...}`).
 *
 * Single-quoted strings are normalised to double-quote delimiters.
 * Line counts are preserved (newlines inside comments are kept).
 * Regex literals pass through unchanged (intentional non-handling).
 *
 * Implementation: single-pass character-level state machine with an
 * explicit stack for nested template-expression contexts and per-frame
 * brace-depth tracking.
 */
export function stripNonCode(source: string): string {
  if (source.length === 0) return '';

  let state: StripState = 'CODE';
  const out: string[] = [];
  const len = source.length;

  // Stack for ${...} expression contexts inside template literals.
  // Each frame stores the brace depth for that expression level.
  const braceDepth: number[] = [];

  let i = 0;

  while (i < len) {
    const ch = source.charAt(i);
    const next: string | undefined = i + 1 < len ? source[i + 1] : undefined;

    switch (state) {
      // ──────────────────────────────────────────────────────────────
      // CODE — normal source code
      // ──────────────────────────────────────────────────────────────
      case 'CODE': {
        // Line comment start
        if (ch === '/' && next === '/') {
          state = 'LINE_COMMENT';
          i += 2;
          break;
        }

        // Block comment start
        if (ch === '/' && next === '*') {
          state = 'BLOCK_COMMENT';
          i += 2;
          break;
        }

        // Double-quoted string
        if (ch === '"') {
          state = 'DQ_STRING';
          out.push('"');
          i += 1;
          break;
        }

        // Single-quoted string (normalise delimiter to double quote)
        if (ch === "'") {
          state = 'SQ_STRING';
          out.push('"');
          i += 1;
          break;
        }

        // Template literal
        if (ch === '`') {
          state = 'TEMPLATE';
          out.push('`');
          i += 1;
          break;
        }

        // Closing brace — may exit a template expression
        if (ch === '}' && braceDepth.length > 0) {
          const top = braceDepth[braceDepth.length - 1] ?? 0;
          if (top === 0) {
            // End of ${...} expression — return to enclosing TEMPLATE
            braceDepth.pop();
            state = 'TEMPLATE';
            i += 1;
            break;
          }
          // Nested brace close inside expression
          braceDepth[braceDepth.length - 1] = top - 1;
          out.push('}');
          i += 1;
          break;
        }

        // Opening brace inside a template expression — track depth
        if (ch === '{' && braceDepth.length > 0) {
          const idx = braceDepth.length - 1;
          braceDepth[idx] = (braceDepth[idx] ?? 0) + 1;
          out.push('{');
          i += 1;
          break;
        }

        // Default — emit character
        out.push(ch);
        i += 1;
        break;
      }

      // ──────────────────────────────────────────────────────────────
      // LINE_COMMENT — skip until newline
      // ──────────────────────────────────────────────────────────────
      case 'LINE_COMMENT': {
        if (ch === '\n') {
          state = 'CODE';
          out.push('\n');
        }
        i += 1;
        break;
      }

      // ──────────────────────────────────────────────────────────────
      // BLOCK_COMMENT — skip until */  (preserve newlines)
      // ──────────────────────────────────────────────────────────────
      case 'BLOCK_COMMENT': {
        if (ch === '*' && next === '/') {
          state = 'CODE';
          i += 2;
          break;
        }
        if (ch === '\n') {
          out.push('\n');
        }
        i += 1;
        break;
      }

      // ──────────────────────────────────────────────────────────────
      // DQ_STRING — strip content, handle escapes
      // ──────────────────────────────────────────────────────────────
      case 'DQ_STRING': {
        if (ch === '\\') {
          // Skip escaped character
          i += 2;
          break;
        }
        if (ch === '"') {
          state = 'CODE';
          out.push('"');
          i += 1;
          break;
        }
        // Strip string content
        i += 1;
        break;
      }

      // ──────────────────────────────────────────────────────────────
      // SQ_STRING — strip content, handle escapes, close with "
      // ──────────────────────────────────────────────────────────────
      case 'SQ_STRING': {
        if (ch === '\\') {
          // Skip escaped character
          i += 2;
          break;
        }
        if (ch === "'") {
          state = 'CODE';
          out.push('"'); // normalise to double quote
          i += 1;
          break;
        }
        // Strip string content
        i += 1;
        break;
      }

      // ──────────────────────────────────────────────────────────────
      // TEMPLATE — inside backtick literal, strip text, handle ${
      // ──────────────────────────────────────────────────────────────
      case 'TEMPLATE': {
        if (ch === '\\') {
          // Skip escaped character (e.g. \` \$ inside template)
          i += 2;
          break;
        }

        // Template expression start: ${
        if (ch === '$' && next === '{') {
          braceDepth.push(0);
          state = 'CODE';
          i += 2;
          break;
        }

        // Closing backtick — end this template literal
        if (ch === '`') {
          state = 'CODE';
          out.push('`');
          i += 1;
          break;
        }

        // Strip template text content
        i += 1;
        break;
      }
    }
  }

  return out.join('');
}
