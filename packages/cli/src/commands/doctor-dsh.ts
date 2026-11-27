import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DSH_DEFAULT_PROFILE,
  DSH_PLUGIN_PACKAGE_NAME,
  resolveDshCanonicalPluginDir,
  resolveDshProfileDir,
  resolveDshProfilePluginDir,
  validateDshProfileName,
} from '../dsh/paths.js';

export interface DoctorDshOptions {
  env?: Record<string, string | undefined>;
  profile?: string;
  targetDir?: string;
}

export interface DoctorDshResult {
  exitCode: number;
  output: string;
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function inspectBundleFiles(pluginDir: string): { issues: string[]; version: string } {
  const issues: string[] = [];
  const manifest = readJsonRecord(join(pluginDir, 'package.json'));
  const version = typeof manifest?.version === 'string' ? manifest.version : 'unknown';

  if (!manifest || manifest.name !== DSH_PLUGIN_PACKAGE_NAME) {
    issues.push(`package.json missing or invalid name (expected ${DSH_PLUGIN_PACKAGE_NAME})`);
  }

  const dshMeta =
    manifest && typeof manifest.dsh === 'object' && manifest.dsh !== null
      ? (manifest.dsh as Record<string, unknown>)
      : undefined;
  const bundleMeta =
    dshMeta && typeof dshMeta.bundle === 'object' && dshMeta.bundle !== null
      ? (dshMeta.bundle as Record<string, unknown>)
      : undefined;
  if (bundleMeta?.patch !== './cordis.patch.yml') {
    issues.push('package.json missing dsh.bundle.patch = "./cordis.patch.yml"');
  }

  const patchPath = join(pluginDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) {
    issues.push('cordis.patch.yml missing');
  } else {
    const patchText = readFileSync(patchPath, 'utf8');
    if (!patchText.includes('id: locus-memory') || !patchText.includes(DSH_PLUGIN_PACKAGE_NAME)) {
      issues.push('cordis.patch.yml missing locus-memory entry');
    }
  }

  if (!existsSync(join(pluginDir, 'lib', 'index.js'))) {
    issues.push('lib/index.js missing');
  }

  const skillPath = join(pluginDir, 'skills', 'locus-memory', 'SKILL.md');
  if (!existsSync(skillPath) || !readFileSync(skillPath, 'utf8').trimStart().startsWith('---')) {
    issues.push('skills/locus-memory/SKILL.md missing or missing YAML frontmatter');
  }

  const runtimeDir = join(pluginDir, 'runtime');
  for (const runtimeFile of ['server.js', 'package.json', 'runtime.json']) {
    if (!existsSync(join(runtimeDir, runtimeFile))) {
      issues.push(`runtime/${runtimeFile} missing`);
    }
  }

  return { issues, version };
}

export function formatDoctorDsh(options: DoctorDshOptions = {}): DoctorDshResult {
  const env = options.env ?? process.env;
  const customTarget = options.targetDir?.trim();

  if (customTarget) {
    if (!existsSync(customTarget)) {
      return {
        exitCode: 1,
        output: [
          'Locus DeepSeek Harness (dsh) doctor',
          `Plugin dir: ${customTarget}`,
          'Status: missing (run `locus-memory install dsh --target <dir> --yes`)',
        ].join('\n'),
      };
    }

    const { issues, version } = inspectBundleFiles(customTarget);
    const healthy = issues.length === 0;
    const lines = [
      'Locus DeepSeek Harness (dsh) doctor',
      `Node version: ${process.version}`,
      `Plugin dir: ${customTarget}`,
      `Version: ${version}`,
      `Status: ${healthy ? 'ok' : 'broken'}`,
    ];
    if (!healthy) {
      lines.push(`Issues (${issues.length}):`);
      for (const issue of issues) {
        lines.push(`  - ${issue}`);
      }
    }
    return {
      exitCode: healthy ? 0 : 1,
      output: lines.join('\n'),
    };
  }

  const profile = validateDshProfileName(options.profile ?? DSH_DEFAULT_PROFILE);
  const profileDir = resolveDshProfileDir(profile, env);
  const profileManifestPath = join(profileDir, 'package.json');
  const profilePluginDir = resolveDshProfilePluginDir(profile, env);
  const canonicalDir = resolveDshCanonicalPluginDir(env);

  if (!existsSync(profileManifestPath)) {
    return {
      exitCode: 1,
      output: [
        'Locus DeepSeek Harness (dsh) doctor',
        `Profile: ${profile} (${profileDir})`,
        `Status: missing (profile manifest not found at ${profileManifestPath})`,
      ].join('\n'),
    };
  }

  const profileManifest = readJsonRecord(profileManifestPath);
  const deps =
    profileManifest &&
    typeof profileManifest.dependencies === 'object' &&
    profileManifest.dependencies !== null
      ? (profileManifest.dependencies as Record<string, unknown>)
      : undefined;
  const dshField =
    profileManifest && typeof profileManifest.dsh === 'object' && profileManifest.dsh !== null
      ? (profileManifest.dsh as Record<string, unknown>)
      : undefined;
  const profileField =
    dshField && typeof dshField.profile === 'object' && dshField.profile !== null
      ? (dshField.profile as Record<string, unknown>)
      : undefined;
  const bundles = Array.isArray(profileField?.bundles) ? profileField.bundles : [];
  const hasBundleRegistration = bundles.includes(DSH_PLUGIN_PACKAGE_NAME);
  const hasDependencyRegistration = typeof deps?.[DSH_PLUGIN_PACKAGE_NAME] === 'string';

  if (!existsSync(profilePluginDir) && !hasBundleRegistration && !hasDependencyRegistration) {
    return {
      exitCode: 1,
      output: [
        'Locus DeepSeek Harness (dsh) doctor',
        `Profile: ${profile} (${profileDir})`,
        `Plugin dir: ${profilePluginDir}`,
        'Status: missing (run `locus-memory install dsh --yes`)',
      ].join('\n'),
    };
  }

  const issues: string[] = [];
  if (!hasDependencyRegistration) {
    issues.push(`profile package.json missing dependencies["${DSH_PLUGIN_PACKAGE_NAME}"]`);
  }
  if (!hasBundleRegistration) {
    issues.push(`profile package.json missing "${DSH_PLUGIN_PACKAGE_NAME}" in dsh.profile.bundles`);
  }
  if (!existsSync(canonicalDir)) {
    issues.push(`canonical bundle dir missing at ${canonicalDir}`);
  }

  let version = 'unknown';
  if (!existsSync(profilePluginDir)) {
    issues.push(`profile bundle directory missing at ${profilePluginDir}`);
  } else {
    const inspected = inspectBundleFiles(profilePluginDir);
    version = inspected.version;
    issues.push(...inspected.issues);
  }

  const healthy = issues.length === 0;
  const lines = [
    'Locus DeepSeek Harness (dsh) doctor',
    `Node version: ${process.version}`,
    `Profile: ${profile} (${profileDir})`,
    `Plugin dir: ${profilePluginDir}`,
    `Canonical dir: ${canonicalDir}`,
    `Version: ${version}`,
    `Status: ${healthy ? 'ok' : 'broken'}`,
  ];
  if (!healthy) {
    lines.push(`Issues (${issues.length}):`);
    for (const issue of issues) {
      lines.push(`  - ${issue}`);
    }
  }

  return {
    exitCode: healthy ? 0 : 1,
    output: lines.join('\n'),
  };
}
