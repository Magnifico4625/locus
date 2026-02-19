export const HARDCODED_IGNORE: string[] = [
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.output',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  '*.min.js',
  '*.map',
  '*.lock',
  'package-lock.json',
  '*.d.ts',
  'coverage',
  '.turbo',
  '.vercel',
  '.cache',
  'tmp',
  'temp',
];

const globPatterns: string[] = HARDCODED_IGNORE.filter((entry) => entry.includes('*'));
const plainNames: Set<string> = new Set(HARDCODED_IGNORE.filter((entry) => !entry.includes('*')));

function matchesGlob(basename: string, pattern: string): boolean {
  // Only handles "*.ext" style patterns — suffix match after stripping leading "*"
  const suffix = pattern.slice(1);
  return basename.endsWith(suffix);
}

export function shouldIgnore(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((s) => s.length > 0);

  for (const segment of segments) {
    if (plainNames.has(segment)) {
      return true;
    }
  }

  const basename = segments[segments.length - 1] ?? '';
  for (const pattern of globPatterns) {
    if (matchesGlob(basename, pattern)) {
      return true;
    }
  }

  return false;
}
