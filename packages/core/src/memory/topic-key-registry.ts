import type { DurableMemoryType } from '../types.js';

export interface TopicKeyInput {
  memoryType: DurableMemoryType;
  summary: string;
}

export type CanonicalTopicKey =
  | 'auth_strategy'
  | 'capture_strategy'
  | 'codex_hooks_strategy'
  | 'database_choice'
  | 'track_c_acceptance'
  | 'user_workflow_style';

interface TopicKeyRule {
  key: CanonicalTopicKey;
  memoryTypes?: DurableMemoryType[];
  any: string[];
  all?: string[][];
}

const TOPIC_KEY_RULES: TopicKeyRule[] = [
  {
    key: 'database_choice',
    memoryTypes: ['decision'],
    any: ['postgresql', 'postgres', 'sqlite', 'mysql'],
    all: [
      [
        'database',
        'store',
        'storage',
        'memory',
        'db',
        'баз',
        'хранилищ',
        'памят',
        'решили',
        'использовать',
      ],
    ],
  },
  {
    key: 'auth_strategy',
    memoryTypes: ['decision'],
    any: ['oauth', 'github oauth', 'auth strategy', 'authentication strategy'],
    all: [['auth', 'authentication', 'login', 'логин', 'авторизац', 'аутентификац']],
  },
  {
    key: 'codex_hooks_strategy',
    memoryTypes: ['decision', 'rejected_alternative', 'constraint'],
    any: ['hook-first', 'hooks', 'hook', 'хук'],
    all: [['codex', 'capture', 'захват'], ['reject', 'rejected', 'отказ', 'отказались', 'avoid']],
  },
  {
    key: 'capture_strategy',
    memoryTypes: ['decision'],
    any: ['capture strategy', 'capture mode', 'redacted capture', 'bounded redacted'],
    all: [['capture', 'захват', 'memory', 'памят', 'recall'], ['redacted', 'metadata', 'full']],
  },
  {
    key: 'user_workflow_style',
    memoryTypes: ['preference', 'style', 'constraint'],
    any: [
      'one task at a time',
      'approval gate',
      'approval gates',
      'по одному таску',
      'стиль работы',
      'атомарного таска',
    ],
    all: [['task', 'таск', 'задач'], ['approve', 'approval', 'одобрен', 'одобрения']],
  },
  {
    key: 'track_c_acceptance',
    memoryTypes: ['next_step', 'validation_fact'],
    any: ['track c', 'acceptance fixtures', 'acceptance matrix', 'memory_recall'],
    all: [['acceptance', 'track c'], ['recall', 'fixtures', 'docs', 'matrix']],
  },
];

export function deriveCanonicalTopicKey(input: TopicKeyInput): CanonicalTopicKey | undefined {
  const normalized = normalizeSummary(input.summary);

  for (const rule of TOPIC_KEY_RULES) {
    if (rule.memoryTypes && !rule.memoryTypes.includes(input.memoryType)) {
      continue;
    }

    if (!includesAny(normalized, rule.any)) {
      continue;
    }

    if (rule.all && !rule.all.every((group) => includesAny(normalized, group))) {
      continue;
    }

    return rule.key;
  }

  return undefined;
}

function normalizeSummary(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}
