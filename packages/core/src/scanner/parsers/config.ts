export interface ProjectConfig {
  name?: string;
  stack: string[];
  scripts: string[];
  dependencies: string[];
  workspaces?: string[];
}

const EMPTY_CONFIG: ProjectConfig = { stack: [], scripts: [], dependencies: [] };

function safeKeys(obj: unknown): string[] {
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.keys(obj);
}

export function parsePackageJson(content: string): ProjectConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return EMPTY_CONFIG;
  }

  if (typeof raw !== 'object' || raw === null) return EMPTY_CONFIG;
  const pkg = raw as Record<string, unknown>;

  const deps = safeKeys(pkg.dependencies);
  const devDeps = safeKeys(pkg.devDependencies);

  const name = typeof pkg.name === 'string' ? pkg.name : undefined;
  const stack = deps;
  const scripts = safeKeys(pkg.scripts);
  const dependencies = [...deps, ...devDeps];
  const workspaces = Array.isArray(pkg.workspaces)
    ? (pkg.workspaces as unknown[]).filter((w): w is string => typeof w === 'string')
    : undefined;

  return { name, stack, scripts, dependencies, workspaces };
}

export function parseTsConfig(content: string): Record<string, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return {};
  }

  if (typeof raw !== 'object' || raw === null) return {};
  const tsconfig = raw as Record<string, unknown>;

  const compilerOptions = tsconfig.compilerOptions;
  if (typeof compilerOptions !== 'object' || compilerOptions === null) return {};

  const co = compilerOptions as Record<string, unknown>;
  const paths = co.paths;
  if (typeof paths !== 'object' || paths === null) return {};

  const result: Record<string, string> = {};
  for (const [alias, targets] of Object.entries(paths as Record<string, unknown>)) {
    if (Array.isArray(targets) && targets.length > 0) {
      const first = targets[0];
      if (typeof first === 'string') {
        result[alias] = first;
      }
    }
  }

  return result;
}
