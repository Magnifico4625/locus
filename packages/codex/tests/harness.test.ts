import { describe, expect, it } from 'vitest';
import * as codex from '../src/index.js';

describe('@locus/codex test harness', () => {
  it('loads the package entrypoint', () => {
    expect(typeof codex).toBe('object');
  });
});
