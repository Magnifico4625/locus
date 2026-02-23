// tests/security/redact.test.ts
import { describe, expect, it } from 'vitest';
import { redact } from '../../src/security/redact.js';

describe('redact', () => {
  // --- Must redact ---
  it('redacts OpenAI API keys', () => {
    expect(redact('key=sk-abc123def456ghi789jkl')).toContain('[REDACTED]');
    expect(redact('key=sk-abc123def456ghi789jkl')).not.toContain('abc123');
  });

  it('redacts GitHub PATs', () => {
    expect(redact('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('ghp_[REDACTED]');
  });

  it('redacts GitLab PATs', () => {
    expect(redact('glpat-xxxxxxxxxxxxxxxxxxxx')).toBe('glpat-[REDACTED]');
  });

  it('redacts Slack tokens', () => {
    expect(redact('xoxb-123456789-abcdefgh')).toBe('xox_-[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy')).toContain(
      'Bearer [REDACTED]',
    );
  });

  it('redacts AWS access keys', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA[REDACTED]');
  });

  it('redacts connection strings', () => {
    expect(redact('postgres://user:p4ss_example@host:5432/db')).toBe('postgres://[REDACTED]');
    expect(redact('mongodb://admin:s3cr3t_example@cluster.example.net/mydb')).toBe('mongodb://[REDACTED]');
  });

  it('redacts KEY=VALUE patterns', () => {
    expect(redact('API_KEY=some_long_secret_value_here')).toBe('API_KEY=[REDACTED]');
    expect(redact('DATABASE_PASSWORD: "supersecret123"')).toContain('[REDACTED]');
  });

  it('redacts private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...content...\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[REDACTED_PRIVATE_KEY]');
  });

  // --- Must NOT redact (false positive protection) ---
  it('does not redact function names with token/key in name', () => {
    expect(redact('export function validateToken(token: string) {}')).toBe(
      'export function validateToken(token: string) {}',
    );
  });

  it('does not redact short constants', () => {
    expect(redact('const MAX_TOKEN_LENGTH = 256')).toBe('const MAX_TOKEN_LENGTH = 256');
  });

  it('does not redact import statements mentioning secrets', () => {
    expect(redact('import { SECRET_MANAGER } from "./config"')).toBe(
      'import { SECRET_MANAGER } from "./config"',
    );
  });

  it('does not redact comments about passwords', () => {
    expect(redact('// This is a comment about password hashing')).toBe(
      '// This is a comment about password hashing',
    );
  });

  it('does not redact base64 of short strings', () => {
    expect(redact('const base64 = btoa("hello world")')).toBe('const base64 = btoa("hello world")');
  });
});
