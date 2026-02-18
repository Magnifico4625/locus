export const DENYLIST_FILES: string[] = [
  '.env',
  '.env.*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials.*',
  'secrets.*',
  'service-account*.json',
];

export function isDenylisted(_filePath: string): boolean {
  // TODO: implement denylist matching
  return false;
}
