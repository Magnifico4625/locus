/**
 * Detects which AI coding client launched the MCP server.
 * @returns {'claude-code' | 'codex' | 'generic'}
 */
export function detectClientEnv() {
  if (process.env.CODEX_HOME) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'generic';
}
