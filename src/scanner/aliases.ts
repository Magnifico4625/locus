export interface PathAliasMap {
  [alias: string]: string;
}

export function loadPathAliases(rawPaths: Record<string, string>): PathAliasMap {
  return { ...rawPaths };
}

export function resolveAlias(importPath: string, aliases: PathAliasMap): string | undefined {
  // Sort alias keys by prefix length descending (greedy: longest match wins)
  const sortedKeys = Object.keys(aliases).sort((a, b) => b.length - a.length);

  for (const aliasKey of sortedKeys) {
    const aliasValue = aliases[aliasKey] ?? '';

    // Strip trailing "/*" from both key and value to get bare prefixes
    const aliasPrefix = aliasKey.endsWith('/*') ? aliasKey.slice(0, -2) : aliasKey;
    const targetPrefix = aliasValue.endsWith('/*') ? aliasValue.slice(0, -2) : aliasValue;

    if (importPath.startsWith(aliasPrefix)) {
      const remainder = importPath.slice(aliasPrefix.length);
      const resolved = targetPrefix + remainder;

      // Strip leading "./" from the result
      return resolved.startsWith('./') ? resolved.slice(2) : resolved;
    }
  }

  return undefined;
}
