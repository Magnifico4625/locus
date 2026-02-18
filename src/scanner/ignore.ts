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

export function shouldIgnore(_filePath: string, _gitignoreRules: string[]): boolean {
  // TODO: implement ignore logic
  return false;
}
