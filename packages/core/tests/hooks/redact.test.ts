// tests/hooks/redact.test.ts — mirrors tests/security/redact.test.ts for hook JS port
import { describe, expect, it } from 'vitest';

describe('hook redact.js', () => {
  // --- Must redact ---
  it('redacts OpenAI API keys', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('key=sk-abc123def456ghi789jkl')).toContain('[REDACTED]');
    expect(redact('key=sk-abc123def456ghi789jkl')).not.toContain('abc123');
  });

  it('redacts GitHub PATs', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('ghp_[REDACTED]');
  });

  it('redacts GitLab PATs', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('glpat-xxxxxxxxxxxxxxxxxxxx')).toBe('glpat-[REDACTED]');
  });

  it('redacts Slack tokens', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('xoxb-123456789-abcdefgh')).toBe('xox_-[REDACTED]');
  });

  it('redacts Bearer tokens', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy')).toContain(
      'Bearer [REDACTED]',
    );
  });

  it('redacts AWS access keys', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA[REDACTED]');
  });

  it('redacts connection strings', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('postgres://user:p4ss_example@host:5432/db')).toBe('postgres://[REDACTED]');
    expect(redact('mongodb://admin:s3cr3t_example@cluster.example.net/mydb')).toBe(
      'mongodb://[REDACTED]',
    );
  });

  it('redacts KEY=VALUE patterns', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('API_KEY=some_long_secret_value_here')).toBe('API_KEY=[REDACTED]');
    expect(redact('DATABASE_PASSWORD: "supersecret123"')).toContain('[REDACTED]');
  });

  it('redacts private key blocks', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...content...\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[REDACTED_PRIVATE_KEY]');
  });

  it('redacts pk- prefixed keys', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('pk-abc123def456ghi789jkl')).toBe('pk-[REDACTED]');
  });

  it('redacts gho_ GitHub OAuth tokens', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('gho_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('gho_[REDACTED]');
  });

  // --- Must NOT redact (false positive protection) ---
  it('does not redact function names with token/key in name', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('export function validateToken(token: string) {}')).toBe(
      'export function validateToken(token: string) {}',
    );
  });

  it('does not redact short constants', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('const MAX_TOKEN_LENGTH = 256')).toBe('const MAX_TOKEN_LENGTH = 256');
  });

  it('does not redact import statements mentioning secrets', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('import { SECRET_MANAGER } from "./config"')).toBe(
      'import { SECRET_MANAGER } from "./config"',
    );
  });

  it('does not redact comments about passwords', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('// This is a comment about password hashing')).toBe(
      '// This is a comment about password hashing',
    );
  });

  // --- Edge cases ---
  it('handles non-string input gracefully', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(redact(null as any)).toBe('');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(redact(undefined as any)).toBe('');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(redact(42 as any)).toBe('');
  });

  it('returns empty string unchanged', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    expect(redact('')).toBe('');
  });

  it('handles text with multiple secrets', async () => {
    const { redact } = await import('../../../claude-code/hooks/redact.js');
    const input = 'API_KEY=mysecretkey123456 and ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const result = redact(input);
    expect(result).toContain('API_KEY=[REDACTED]');
    expect(result).toContain('ghp_[REDACTED]');
    expect(result).not.toContain('mysecretkey123456');
    expect(result).not.toContain('1234567890abcdefghijklmnopqrstuvwxyz');
  });

  it('produces identical output to core redact.ts patterns', async () => {
    const { redact: hookRedact } = await import('../../../claude-code/hooks/redact.js');
    const { redact: coreRedact } = await import('../../src/security/redact.js');

    const testCases = [
      'sk-abc123def456ghi789jkl',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      'glpat-xxxxxxxxxxxxxxxxxxxx',
      'xoxb-123456789-abcdefgh',
      'AKIAIOSFODNN7EXAMPLE',
      'postgres://user:pass_example@host:5432/db',
      'Bearer eyJhbGciOiJIUzI1NiJ9.xxx.yyy',
      'API_KEY=some_long_secret_value_here',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIE...content...\n-----END RSA PRIVATE KEY-----',
      'Normal text without secrets',
    ];

    for (const input of testCases) {
      expect(hookRedact(input)).toBe(coreRedact(input));
    }
  });
});
