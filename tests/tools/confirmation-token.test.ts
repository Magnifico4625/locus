import { describe, expect, it } from 'vitest';
import { ConfirmationTokenStore } from '../../src/tools/confirmation-token.js';

describe('ConfirmationTokenStore', () => {
  it('generate returns token with correct prefix format', () => {
    const store = new ConfirmationTokenStore('purge');
    const token = store.generate();
    expect(token).toMatch(/^purge-[0-9a-f]{8}$/);
  });

  it('generate returns token with custom prefix', () => {
    const store = new ConfirmationTokenStore('forget');
    const token = store.generate();
    expect(token).toMatch(/^forget-[0-9a-f]{8}$/);
  });

  it('generate creates unique tokens on each call', () => {
    const store = new ConfirmationTokenStore('purge');
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) {
      tokens.add(store.generate());
    }
    // At least most should be unique (crypto random)
    expect(tokens.size).toBeGreaterThan(15);
  });

  it('validate returns true for freshly generated token', () => {
    const store = new ConfirmationTokenStore('purge');
    const token = store.generate();
    expect(store.validate(token)).toBe(true);
  });

  it('validate returns false for unknown token', () => {
    const store = new ConfirmationTokenStore('purge');
    store.generate();
    expect(store.validate('purge-00000000')).toBe(false);
  });

  it('validate returns false for expired token', () => {
    const store = new ConfirmationTokenStore('purge', 1000); // 1s TTL
    const now = Date.now();
    const token = store.generate(now);
    // Token is valid immediately
    expect(store.validate(token, now)).toBe(true);
    // Token is expired after TTL
    expect(store.validate(token, now + 1001)).toBe(false);
  });

  it('consume returns true and invalidates token', () => {
    const store = new ConfirmationTokenStore('purge');
    const token = store.generate();
    expect(store.consume(token)).toBe(true);
    // Second consume should fail — single-use
    expect(store.consume(token)).toBe(false);
  });

  it('consume returns false for invalid token', () => {
    const store = new ConfirmationTokenStore('purge');
    expect(store.consume('purge-invalid1')).toBe(false);
  });

  it('consume returns false for expired token', () => {
    const store = new ConfirmationTokenStore('purge', 1000);
    const now = Date.now();
    const token = store.generate(now);
    expect(store.consume(token, now + 1001)).toBe(false);
  });

  it('only one active token at a time — generate clears old', () => {
    const store = new ConfirmationTokenStore('purge');
    const first = store.generate();
    const second = store.generate();
    // First token should be invalidated
    expect(store.validate(first)).toBe(false);
    // Second token should be valid
    expect(store.validate(second)).toBe(true);
  });
});
