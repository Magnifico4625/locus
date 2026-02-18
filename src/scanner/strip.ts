export type StripState =
  | 'CODE'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT'
  | 'SQ_STRING'
  | 'DQ_STRING'
  | 'TEMPLATE';

export function stripNonCode(_source: string): string {
  // TODO: implement state machine (Contract 4)
  return _source;
}
