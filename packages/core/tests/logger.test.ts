import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Logger', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'locus-log-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes log entries to file', async () => {
    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug');
    logger.info('test message');
    logger.close();
    const content = readFileSync(join(tempDir, 'locus.log'), 'utf-8');
    expect(content).toContain('test message');
    expect(content).toContain('[info]');
  });

  it('respects log level filtering', async () => {
    const { createLogger } = await import('../src/logger.js');
    const logger = createLogger(join(tempDir, 'locus.log'), 'error');
    logger.info('should not appear');
    logger.error('should appear');
    logger.close();
    const content = readFileSync(join(tempDir, 'locus.log'), 'utf-8');
    expect(content).not.toContain('should not appear');
    expect(content).toContain('should appear');
  });

  it('rotates when file exceeds maxSize', async () => {
    const { createLogger } = await import('../src/logger.js');
    const maxSize = 500; // small size for testing
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug', maxSize);
    for (let i = 0; i < 100; i++) {
      logger.debug(`line ${i} padding ${'x'.repeat(20)}`);
    }
    logger.close();
    expect(existsSync(join(tempDir, 'locus.log'))).toBe(true);
    expect(existsSync(join(tempDir, 'locus.log.1'))).toBe(true);
  });

  it('keeps at most 3 rotated files', async () => {
    const { createLogger } = await import('../src/logger.js');
    const maxSize = 200;
    const logger = createLogger(join(tempDir, 'locus.log'), 'debug', maxSize);
    for (let i = 0; i < 500; i++) {
      logger.debug(`line ${i} ${'x'.repeat(50)}`);
    }
    logger.close();
    expect(existsSync(join(tempDir, 'locus.log'))).toBe(true);
    // Should not have more than 3 backup files
    expect(existsSync(join(tempDir, 'locus.log.4'))).toBe(false);
  });
});

describe('maskPath', () => {
  it('returns path unchanged when disabled', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('/home/user/project/src/auth/login.ts', false)).toBe(
      '/home/user/project/src/auth/login.ts',
    );
  });

  it('masks long paths keeping last 3 components', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('/home/user/secret-client/internal-api/src/auth/login.ts', true)).toBe(
      '****/src/auth/login.ts',
    );
  });

  it('does not mask short paths', async () => {
    const { maskPath } = await import('../src/logger.js');
    expect(maskPath('src/auth/login.ts', true)).toBe('src/auth/login.ts');
  });
});
