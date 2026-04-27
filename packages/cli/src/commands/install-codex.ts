import { resolveCodexHome, resolveCodexSkillPath } from '../codex/paths.js';
import { buildRuntimePackageSpecifier, resolvePackageVersion } from '../package-info.js';

export interface InstallCodexDryRunOptions {
  env?: Record<string, string | undefined>;
  startDir?: string;
}

export function formatInstallCodexDryRun(options: InstallCodexDryRunOptions = {}): string {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const skillPath = resolveCodexSkillPath(env, 'locus-memory');
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));

  return [
    'Locus Codex install dry-run',
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: npx -y ${runtimeSpecifier} mcp`,
    'Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error',
  ].join('\n');
}
