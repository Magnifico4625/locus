export interface ProjectConfig {
  name?: string;
  stack: string[];
  scripts: string[];
  dependencies: string[];
  workspaces?: string[];
}

export function parsePackageJson(_content: string): ProjectConfig {
  // TODO: implement package.json parsing
  return { stack: [], scripts: [], dependencies: [] };
}

export function parseTsConfig(_content: string): Record<string, string> {
  // TODO: implement tsconfig.json path parsing
  return {};
}
