import type { SemanticMemory } from '../memory/semantic.js';
import { redact } from '../security/redact.js';
import type { MemoryEntry } from '../types.js';

export interface RememberDeps {
  semantic: SemanticMemory;
}

/**
 * Store a new memory entry in semantic memory after redacting any secrets.
 *
 * 1. Applies redact() to sanitize secrets from the text.
 * 2. Calls deps.semantic.add(redactedText, tags) to persist the entry.
 * 3. Returns the created MemoryEntry.
 */
export function handleRemember(text: string, tags: string[], deps: RememberDeps): MemoryEntry {
  const redacted = redact(text);
  return deps.semantic.add(redacted, tags);
}
