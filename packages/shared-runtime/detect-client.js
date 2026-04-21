/**
 * @typedef {'claude-code' | 'codex' | 'generic'} ClientEnv
 * @typedef {'cli' | 'desktop' | 'extension' | 'generic'} ClientSurface
 *
 * @typedef {object} ClientRuntime
 * @property {ClientEnv} client
 * @property {ClientSurface} surface
 * @property {boolean} detected
 * @property {string[]} evidence
 */

/**
 * Detects which AI coding client launched the MCP server and returns
 * a structured runtime snapshot for downstream diagnostics.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {readonly string[]} [_argv]
 * @param {string} [_cwd]
 * @returns {ClientRuntime}
 */
export function detectClientRuntime(
  env = process.env,
  _argv = process.argv,
  _cwd = process.cwd(),
) {
  if (hasNonEmptyValue(env.CODEX_HOME)) {
    return {
      client: 'codex',
      surface: 'cli',
      detected: true,
      evidence: ['env:CODEX_HOME'],
    };
  }

  if (hasNonEmptyValue(env.CLAUDE_PLUGIN_ROOT)) {
    return {
      client: 'claude-code',
      surface: 'cli',
      detected: true,
      evidence: ['env:CLAUDE_PLUGIN_ROOT'],
    };
  }

  return {
    client: 'generic',
    surface: 'generic',
    detected: false,
    evidence: ['fallback:generic'],
  };
}

/**
 * Detects which AI coding client launched the MCP server.
 * Backward-compatible wrapper over detectClientRuntime().
 * @returns {ClientEnv}
 */
export function detectClientEnv() {
  return detectClientRuntime().client;
}

function hasNonEmptyValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
