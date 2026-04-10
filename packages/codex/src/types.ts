export interface CodexJsonlRecord {
  line: number;
  filePath: string;
  raw: Record<string, unknown>;
}

export interface CodexJsonlParseError {
  line: number;
  filePath: string;
  message: string;
}

export interface CodexJsonlParseResult {
  records: CodexJsonlRecord[];
  errors: CodexJsonlParseError[];
}
