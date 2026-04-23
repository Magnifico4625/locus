import type { CodexRelevanceReason, CodexSpeakerRole } from './relevance.js';

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

export function boundCodexSnippet(
  text: string,
  options: BoundCodexSnippetOptions,
): BoundCodexSnippetResult {
  const normalized = collapseWhitespace(text);
  if (normalized.length === 0) {
    return { text: '', truncated: false };
  }

  const sentenceLimit = options.role === 'assistant' ? ASSISTANT_MAX_SENTENCES : USER_MAX_SENTENCES;
  const charLimit = options.role === 'assistant' ? ASSISTANT_CHAR_LIMIT : USER_CHAR_LIMIT;
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
  return {
    text: truncated ? `${boundedText} ...` : boundedText,
    truncated,
  };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]?/g);
  if (!matches) {
    return [text];
  }

  return matches.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}
