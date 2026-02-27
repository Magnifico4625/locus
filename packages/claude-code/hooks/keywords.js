// Locus RAKE keyword extraction (plain JS — no dependencies)
// Extracts meaningful keywords from user prompts at captureLevel=redacted.
// Algorithm: RAKE (Rapid Automatic Keyword Extraction) — Rose et al. 2010.
//
// Steps:
// 1. Split text into candidate phrases (sequences of non-stopwords)
// 2. Score words by co-occurrence: degree(word) / frequency(word)
// 3. Score phrases as sum of constituent word scores
// 4. Return top N phrases sorted by score

// English common words + programming keywords
const STOPWORDS = new Set([
  // English (~150)
  'the',
  'is',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'as',
  'into',
  'this',
  'that',
  'it',
  'its',
  'be',
  'are',
  'was',
  'were',
  'been',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'up',
  'out',
  'all',
  'also',
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'each',
  'every',
  'both',
  'few',
  'more',
  'some',
  'any',
  'most',
  'other',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'they',
  'them',
  'their',
  'him',
  'her',
  'us',
  'am',
  'being',
  'doing',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'through',
  'again',
  'further',
  'here',
  'there',
  'once',
  'such',
  'only',
  'same',
  'own',
  'now',
  'get',
  'got',
  'go',
  'make',
  'made',
  'take',
  'know',
  'see',
  'come',
  'think',
  'look',
  'want',
  'give',
  'use',
  'find',
  'tell',
  'ask',
  'work',
  'seem',
  'feel',
  'try',
  'leave',
  'call',
  'need',
  'become',
  'keep',
  'let',
  'begin',
  'show',
  'hear',
  'play',
  'run',
  'move',
  'like',
  'live',
  'believe',
  'hold',
  'bring',
  'happen',
  'write',
  'provide',
  'sit',
  'stand',
  'lose',
  'pay',
  'meet',
  'include',
  'continue',
  'set',
  'learn',
  'change',
  'lead',
  'understand',
  'watch',
  'follow',
  'stop',
  'create',
  'speak',
  'read',
  'allow',
  'add',
  'spend',
  'grow',
  'open',
  'walk',
  'win',
  'offer',
  'remember',
  'love',
  'consider',
  'appear',
  'buy',
  'wait',
  'serve',
  'die',
  'send',
  'expect',
  'build',
  'stay',
  'fall',
  'oh',
  'yeah',
  'ok',
  'please',
  'help',
  // Programming
  'function',
  'return',
  'const',
  'let',
  'var',
  'import',
  'export',
  'class',
  'new',
  'null',
  'undefined',
  'true',
  'false',
  'try',
  'catch',
  'throw',
  'async',
  'await',
  'void',
  'type',
  'interface',
  'enum',
  'extends',
  'implements',
  'static',
  'public',
  'private',
  'protected',
]);

/**
 * Splits text into candidate phrases by splitting on stopwords and punctuation.
 * @param {string[]} words — lowercased words
 * @returns {string[][]} array of candidate phrase word arrays
 */
function splitIntoPhrases(words) {
  const phrases = [];
  let current = [];

  for (const word of words) {
    // Strip punctuation from edges for matching
    const cleaned = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

    if (cleaned.length === 0 || STOPWORDS.has(cleaned)) {
      // Stopword or punctuation-only — phrase boundary
      if (current.length > 0) {
        phrases.push(current);
        current = [];
      }
    } else {
      current.push(cleaned);
    }
  }

  if (current.length > 0) {
    phrases.push(current);
  }

  return phrases;
}

/**
 * RAKE keyword extraction.
 * @param {string} text — input text
 * @param {number} [maxKeywords=10] — max phrases to return
 * @returns {string} comma-separated keywords
 */
export function extractKeywords(text, maxKeywords = 10) {
  if (typeof text !== 'string' || text.trim().length === 0) return '';

  const words = text.toLowerCase().split(/\s+/).filter(Boolean);

  // Too short for RAKE — return as-is (trimmed)
  if (words.length <= 3) return text.trim();

  // 1. Split into candidate phrases
  const phrases = splitIntoPhrases(words);
  if (phrases.length === 0) return '';

  // 2. Build word frequency and degree maps
  const freq = new Map();
  const degree = new Map();

  for (const phrase of phrases) {
    const phraseLen = phrase.length;
    for (const word of phrase) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
      degree.set(word, (degree.get(word) ?? 0) + phraseLen);
    }
  }

  // 3. Score each word: degree / frequency
  const wordScore = new Map();
  for (const [word, f] of freq) {
    wordScore.set(word, (degree.get(word) ?? 0) / f);
  }

  // 4. Score each phrase: sum of word scores
  const scored = [];
  const seen = new Set();

  for (const phrase of phrases) {
    const key = phrase.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);

    let score = 0;
    for (const word of phrase) {
      score += wordScore.get(word) ?? 0;
    }
    scored.push({ phrase: key, score });
  }

  // 5. Sort descending by score, then alphabetically for ties
  scored.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));

  // 6. Return top N
  return scored
    .slice(0, maxKeywords)
    .map((s) => s.phrase)
    .join(', ');
}
