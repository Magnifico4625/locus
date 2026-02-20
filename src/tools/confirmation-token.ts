import { randomBytes } from 'node:crypto';

interface PendingToken {
  token: string;
  createdAt: number;
}

const DEFAULT_TTL_MS = 60_000; // 60 seconds

export class ConfirmationTokenStore {
  private tokens = new Map<string, PendingToken>();
  private readonly ttlMs: number;
  private readonly prefix: string;

  constructor(prefix: string, ttlMs = DEFAULT_TTL_MS) {
    this.prefix = prefix;
    this.ttlMs = ttlMs;
  }

  generate(nowMs = Date.now()): string {
    const hex = randomBytes(4).toString('hex');
    const token = `${this.prefix}-${hex}`;
    // Only one active token at a time — clear old ones
    this.tokens.clear();
    this.tokens.set(token, { token, createdAt: nowMs });
    return token;
  }

  validate(token: string, nowMs = Date.now()): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    if (nowMs - entry.createdAt > this.ttlMs) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  consume(token: string, nowMs = Date.now()): boolean {
    if (!this.validate(token, nowMs)) return false;
    this.tokens.delete(token);
    return true;
  }
}
