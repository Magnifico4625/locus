/**
 * @typedef {'claude-code' | 'codex' | 'antigravity' | 'opencode' | 'dsh' | 'generic'} ClientEnv
 * @typedef {'cli' | 'desktop' | 'extension' | 'generic'} ClientSurface
 *
 * @typedef {object} ClientRuntime
 * @property {ClientEnv} client
 * @property {ClientSurface} surface
 * @property {boolean} detected
 * @property {string[]} evidence
 */

const EXPLICIT_CLIENTS = new Set(['claude-code', 'codex', 'antigravity', 'opencode', 'dsh']);
const VALID_SURFACES = new Set(['cli', 'desktop', 'extension']);

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
  const explicitClient = env.LOCUS_CLIENT?.trim();
  if (explicitClient && EXPLICIT_CLIENTS.has(explicitClient)) {
    const client = /** @type {Exclude<ClientEnv, 'generic'>} */ (explicitClient);
    const defaultSurface =
      client === 'antigravity' || client === 'opencode' || client === 'dsh' ? 'desktop' : 'cli';
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, defaultSurface, client === 'codex');
    return {
      client,
      surface,
      detected: true,
      evidence: [`env:LOCUS_CLIENT=${client}`, ...(evidenceKey ? [evidenceKey] : [])],
    };
  }

  if (hasNonEmptyValue(env.LOCUS_ANTIGRAVITY)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, 'desktop', false);
    return {
      client: 'antigravity',
      surface,
      detected: true,
      evidence: ['env:LOCUS_ANTIGRAVITY', ...(evidenceKey ? [evidenceKey] : [])],
    };
  }

  if (hasNonEmptyValue(env.LOCUS_OPENCODE)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, 'desktop', false);
    return {
      client: 'opencode',
      surface,
      detected: true,
      evidence: ['env:LOCUS_OPENCODE', ...(evidenceKey ? [evidenceKey] : [])],
    };
  }

  if (hasNonEmptyValue(env.LOCUS_DSH)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, 'desktop', false);
    return {
      client: 'dsh',
      surface,
      detected: true,
      evidence: ['env:LOCUS_DSH', ...(evidenceKey ? [evidenceKey] : [])],
    };
  }

  if (hasNonEmptyValue(env.CODEX_HOME)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, 'cli', true);
    return {
      client: 'codex',
      surface,
      detected: true,
      evidence: ['env:CODEX_HOME', ...(evidenceKey ? [evidenceKey] : [])],
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

function resolveSurfaceFromEnv(env, defaultSurface, includeCodexOverride) {
  const genericSurface = env.LOCUS_CLIENT_SURFACE;
  if (genericSurface && VALID_SURFACES.has(genericSurface)) {
    return {
      surface: /** @type {ClientSurface} */ (genericSurface),
      evidenceKey: `env:LOCUS_CLIENT_SURFACE=${genericSurface}`,
    };
  }

  if (includeCodexOverride) {
    const codexSurface = env.LOCUS_CODEX_SURFACE;
    if (codexSurface && VALID_SURFACES.has(codexSurface)) {
      return {
        surface: /** @type {ClientSurface} */ (codexSurface),
        evidenceKey: `env:LOCUS_CODEX_SURFACE=${codexSurface}`,
      };
    }
  }

  return {
    surface: /** @type {ClientSurface} */ (defaultSurface),
    evidenceKey: undefined,
  };
}
