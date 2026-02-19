// File denylist matching (Contract 1 — Security Layer 1)
//
// Pattern types supported:
//   basename glob   — *.pem, .env.*, credentials.*
//   exact basename  — .env, id_rsa, .npmrc
//   path suffix     — .docker/config.json, .aws/credentials
//   recursive dir   — **/secrets/**, **/.secrets/**
//
// NOTE: Using // comments instead of /** */ to avoid esbuild
// misinterpreting path-like patterns (e.g. **/) as regex literals.

export const DENYLIST_FILES: string[] = [
  // Environment and config files
  '.env',
  '.env.*',
  '.npmrc',
  '.pypirc',
  '.netrc',

  // Crypto key files
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',

  // SSH keys
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',

  // Credential files
  'credentials.*',
  'secrets.*',
  'service-account*.json',

  // Cloud provider credentials
  '.docker/config.json',
  '.aws/credentials',
  '.azure/accessTokens.json',

  // Secret directories
  '**/secrets/**',
  '**/.secrets/**',
];

// Convert a simple glob pattern (single * only) to a RegExp.
// Splits on * so each literal segment is escaped, then joins with [^/]*.
function matchGlob(name: string, pattern: string): boolean {
  const regexStr = pattern
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${regexStr}$`).test(name);
}

export function isDenylisted(filePath: string): boolean {
  // Normalise Windows backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;

  for (const pattern of DENYLIST_FILES) {
    // Recursive directory pattern: **/dir/**
    if (pattern.startsWith('**/') && pattern.endsWith('/**')) {
      const dir = pattern.slice(3, -3);
      if (normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)) {
        return true;
      }
      continue;
    }

    // Path suffix pattern (contains /)
    if (pattern.includes('/')) {
      if (normalized === pattern || normalized.endsWith(`/${pattern}`)) {
        return true;
      }
      continue;
    }

    // Basename glob pattern
    if (matchGlob(basename, pattern)) {
      return true;
    }
  }

  return false;
}
