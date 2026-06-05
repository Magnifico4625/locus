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
 * LOCUS_CODEX_SURFACE is a diagnostic/debug override for validating Codex
 * desktop and extension paths before stronger upstream surface evidence exists.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {readonly string[]} [_argv]
 * @param {string} [_cwd]
 * @returns {ClientRuntime}
 */
export function detectClientRuntime(env = process.env, _argv = process.argv, _cwd = process.cwd()) {
  if (hasNonEmptyValue(env.CODEX_HOME)) {
    const surface = codexSurfaceFromEnv(env);
    return {
      client: 'codex',
      surface,
      detected: true,
      evidence:
        surface === 'cli'
          ? ['env:CODEX_HOME']
          : ['env:CODEX_HOME', `env:LOCUS_CODEX_SURFACE=${surface}`],
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

function codexSurfaceFromEnv(env) {
  const value = env.LOCUS_CODEX_SURFACE;
  if (value === 'desktop' || value === 'extension' || value === 'cli') {
    return value;
  }
  return 'cli';
}
