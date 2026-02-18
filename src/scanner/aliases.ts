export interface PathAliasMap {
  [alias: string]: string;
}

export function loadPathAliases(_tsconfigPath: string): PathAliasMap {
  // TODO: implement tsconfig path alias resolution
  return {};
}

export function resolveAlias(_importPath: string, _aliases: PathAliasMap): string | undefined {
  // TODO: implement alias resolution
  return undefined;
}
