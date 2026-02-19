// tests/security/file-ignore.test.ts
import { describe, expect, it } from 'vitest';
import { DENYLIST_FILES, isDenylisted } from '../../src/security/file-ignore.js';

describe('isDenylisted', () => {
  it('blocks .env files', () => {
    expect(isDenylisted('.env')).toBe(true);
    expect(isDenylisted('.env.local')).toBe(true);
    expect(isDenylisted('.env.production')).toBe(true);
  });

  it('blocks crypto key files', () => {
    expect(isDenylisted('server.pem')).toBe(true);
    expect(isDenylisted('tls.key')).toBe(true);
    expect(isDenylisted('cert.p12')).toBe(true);
    expect(isDenylisted('keystore.jks')).toBe(true);
  });

  it('blocks SSH keys', () => {
    expect(isDenylisted('id_rsa')).toBe(true);
    expect(isDenylisted('id_ed25519')).toBe(true);
  });

  it('blocks credential files', () => {
    expect(isDenylisted('credentials.json')).toBe(true);
    expect(isDenylisted('secrets.yaml')).toBe(true);
    expect(isDenylisted('service-account-prod.json')).toBe(true);
  });

  it('blocks rc files with tokens', () => {
    expect(isDenylisted('.npmrc')).toBe(true);
    expect(isDenylisted('.pypirc')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(isDenylisted('src/auth/login.ts')).toBe(false);
    expect(isDenylisted('package.json')).toBe(false);
    expect(isDenylisted('README.md')).toBe(false);
    expect(isDenylisted('test.js')).toBe(false);
  });

  it('handles nested paths', () => {
    expect(isDenylisted('config/.env')).toBe(true);
    expect(isDenylisted('deploy/certs/server.pem')).toBe(true);
  });

  it('DENYLIST_FILES is non-empty', () => {
    expect(DENYLIST_FILES.length).toBeGreaterThan(10);
  });
});
