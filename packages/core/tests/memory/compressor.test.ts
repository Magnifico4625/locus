import { describe, expect, it } from 'vitest';
import { MemoryCompressor } from '../../src/memory/compressor.js';
import type { LocusConfig } from '../../src/types.js';
import { LOCUS_DEFAULTS } from '../../src/types.js';

// Helper: build a config override
function makeConfig(overrides: Partial<LocusConfig>): LocusConfig {
  return { ...LOCUS_DEFAULTS, ...overrides };
}

// Helper: build a string of roughly `chars` characters
function makeEntry(chars: number): string {
  return 'x'.repeat(chars);
}

// LOCUS_DEFAULTS.compressionThreshold = 10000 tokens
// estimateTokens = Math.ceil(text.length / 4)
// budget = Math.floor(10000 / 2) = 5000 tokens = 20000 chars max

describe('MemoryCompressor.shouldCompress', () => {
  it('returns false when bufferTokens is below threshold (mode=threshold)', () => {
    const compressor = new MemoryCompressor(
      makeConfig({ compressionMode: 'threshold', compressionThreshold: 10000 }),
    );
    expect(compressor.shouldCompress(9999)).toBe(false);
  });

  it('returns true when bufferTokens is above threshold (mode=threshold)', () => {
    const compressor = new MemoryCompressor(
      makeConfig({ compressionMode: 'threshold', compressionThreshold: 10000 }),
    );
    expect(compressor.shouldCompress(10001)).toBe(true);
  });

  it('returns false when bufferTokens equals threshold (mode=threshold)', () => {
    // Only ABOVE threshold triggers — equal does not
    const compressor = new MemoryCompressor(
      makeConfig({ compressionMode: 'threshold', compressionThreshold: 10000 }),
    );
    expect(compressor.shouldCompress(10000)).toBe(false);
  });

  it('returns false always when mode=manual regardless of bufferTokens', () => {
    const compressor = new MemoryCompressor(
      makeConfig({ compressionMode: 'manual', compressionThreshold: 10000 }),
    );
    expect(compressor.shouldCompress(0)).toBe(false);
    expect(compressor.shouldCompress(1)).toBe(false);
    expect(compressor.shouldCompress(999999)).toBe(false);
  });

  it('returns true when bufferTokens > 0 in mode=aggressive', () => {
    const compressor = new MemoryCompressor(makeConfig({ compressionMode: 'aggressive' }));
    expect(compressor.shouldCompress(1)).toBe(true);
    expect(compressor.shouldCompress(100)).toBe(true);
  });

  it('returns false when bufferTokens is 0 in mode=aggressive', () => {
    const compressor = new MemoryCompressor(makeConfig({ compressionMode: 'aggressive' }));
    expect(compressor.shouldCompress(0)).toBe(false);
  });
});

describe('MemoryCompressor.compress', () => {
  // Use a small threshold so tests don't need huge strings.
  // compressionThreshold = 100 tokens → budget = 50 tokens = 200 chars
  const smallConfig = makeConfig({ compressionThreshold: 100 });

  it('concatenates all entries when total fits within budget', () => {
    const compressor = new MemoryCompressor(smallConfig);
    // 3 entries of 10 chars each = 30 chars = 8 tokens, well within 50-token budget
    const entries = ['hello world', 'foo bar baz', 'qux quux qu'];
    const result = compressor.compress(entries);
    expect(result).toBe('hello world\nfoo bar baz\nqux quux qu');
  });

  it('keeps most recent entries (last in array = most recent) when total exceeds budget', () => {
    const compressor = new MemoryCompressor(smallConfig);
    // budget = 50 tokens = 200 chars
    // Entry A (oldest): 160 chars = 40 tokens — uses the letter 'a'
    // Entry B (newest): 160 chars = 40 tokens — uses the letter 'b'
    // Together 320 chars = 80 tokens > 50 token budget
    // Entry B alone (40 tokens) fits, so only B should be kept
    const entryA = 'a'.repeat(160);
    const entryB = 'b'.repeat(160);
    const result = compressor.compress([entryA, entryB]);
    expect(result).toBe(entryB);
    // The oldest entry must have been discarded
    expect(result).not.toContain('a');
  });

  it('discards oldest entries to fit within threshold/2 tokens', () => {
    const compressor = new MemoryCompressor(smallConfig);
    // budget = 50 tokens = 200 chars
    // 5 entries of 30 chars each = 150 chars total = 38 tokens — fits in budget,
    // BUT with newline separators: 5*30 + 4 newlines = 154 chars = 39 tokens — still fits.
    // Now use entries of 60 chars each = 15 tokens each.
    // 4 entries × 15 tokens = 60 tokens > 50 budget.
    // 3 entries × 15 tokens = 45 tokens ≤ 50 budget → last 3 kept.
    const entry = makeEntry(60);
    const entries = [entry, entry, entry, entry]; // 4 identical 60-char entries
    const result = compressor.compress(entries);
    // Should keep the last 3 entries joined by newlines
    expect(result).toBe([entry, entry, entry].join('\n'));
  });

  it('returns empty string for empty input', () => {
    const compressor = new MemoryCompressor(smallConfig);
    expect(compressor.compress([])).toBe('');
  });

  it('handles single entry that fits within budget', () => {
    const compressor = new MemoryCompressor(smallConfig);
    // budget = 50 tokens = 200 chars; entry is 40 chars = 10 tokens
    const entry = makeEntry(40);
    expect(compressor.compress([entry])).toBe(entry);
  });

  it('handles single entry that exceeds budget (truncates it)', () => {
    const compressor = new MemoryCompressor(smallConfig);
    // budget = 50 tokens = 200 chars; entry is 400 chars = 100 tokens > budget
    const entry = makeEntry(400);
    const result = compressor.compress([entry]);
    // Must be truncated to at most budget * 4 = 200 chars
    expect(result.length).toBeLessThanOrEqual(200);
    // Must be a prefix of the original entry
    expect(entry.startsWith(result)).toBe(true);
  });

  it('joins entries with newline separators', () => {
    const compressor = new MemoryCompressor(smallConfig);
    const entries = ['alpha', 'beta', 'gamma'];
    const result = compressor.compress(entries);
    expect(result).toContain('\n');
    expect(result.split('\n')).toEqual(['alpha', 'beta', 'gamma']);
  });
});
