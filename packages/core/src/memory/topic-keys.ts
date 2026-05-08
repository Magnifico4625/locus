import type { TopicKeyInput } from './topic-key-registry.js';
import { deriveCanonicalTopicKey } from './topic-key-registry.js';

/**
 * @deprecated Compatibility wrapper for existing imports.
 * New code should use deriveCanonicalTopicKey() from topic-key-registry.ts.
 */
export function deriveTopicKey(input: TopicKeyInput): string | undefined {
  return deriveCanonicalTopicKey(input);
}
