import type { CodexRelevanceReason, CodexSpeakerRole } from './relevance.js';
import type { CodexCaptureReason } from './types.js';

interface SnippetLimit {
  chars: number;
  sentences: number;
}

export interface BoundCodexSnippetOptions {
  role: CodexSpeakerRole;
  reason: CodexRelevanceReason;
}

export interface BoundCodexSnippetResult {
  text: string;
  truncated: boolean;
}

const USER_CHAR_LIMIT = 280;
const ASSISTANT_CHAR_LIMIT = 220;
const USER_MAX_SENTENCES = 3;
const ASSISTANT_MAX_SENTENCES = 2;
const GLOBAL_HARD_CHAR_MAX = 640;
const TRUNCATION_SUFFIX = ' ...';
const SNIPPET_LIMITS_BY_REASON = {
  style: { chars: 180, sentences: 1 },
  preference: { chars: 220, sentences: 1 },
  constraint: { chars: 220, sentences: 1 },
  decision: { chars: 320, sentences: 2 },
  rejected_alternative: { chars: 320, sentences: 2 },
  next_step: { chars: 260, sentences: 2 },
  release_context: { chars: 420, sentences: 3 },
  bug_context: { chars: 600, sentences: 4 },
  validation_fact: { chars: 500, sentences: 3 },
} satisfies Partial<Record<CodexCaptureReason, SnippetLimit>>;

export function boundCodexSnippet(
  text: string,
  options: BoundCodexSnippetOptions,
): BoundCodexSnippetResult {
  const normalized = collapseWhitespace(text);
  if (normalized.length === 0) {
    return { text: '', truncated: false };
  }

  const limit = limitForReason(options);
  const sentenceLimit = limit.sentences;
  const charLimit = limit.chars;
  const sentences = splitSentences(normalized);

  const keptSentences: string[] = [];
  for (const sentence of sentences) {
    if (keptSentences.length >= sentenceLimit) {
      break;
    }

    const candidate = [...keptSentences, sentence].join(' ');
    if (candidate.length > charLimit) {
      break;
    }

    keptSentences.push(sentence);
  }

  let boundedText = keptSentences.join(' ');
  if (boundedText.length === 0) {
    boundedText = normalized.slice(0, charLimit).trimEnd();
  }

  const truncated = boundedText.length < normalized.length;
  if (!truncated) {
    return {
      text: boundedText,
      truncated,
    };
  }

  const textBudget = Math.max(0, limit.chars - TRUNCATION_SUFFIX.length);
  return {
    text: `${boundedText.slice(0, textBudget).trimEnd()}${TRUNCATION_SUFFIX}`,
    truncated,
  };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function limitForReason(options: BoundCodexSnippetOptions): SnippetLimit {
  const roleDefault = {
    chars: options.role === 'assistant' ? ASSISTANT_CHAR_LIMIT : USER_CHAR_LIMIT,
    sentences: options.role === 'assistant' ? ASSISTANT_MAX_SENTENCES : USER_MAX_SENTENCES,
  };
  const reasonLimit =
    (SNIPPET_LIMITS_BY_REASON as Partial<Record<CodexCaptureReason, SnippetLimit>>)[
      options.reason
    ] ?? roleDefault;

  return {
    chars: Math.min(reasonLimit.chars, GLOBAL_HARD_CHAR_MAX),
    sentences: reasonLimit.sentences,
  };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-ZА-Я])/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
