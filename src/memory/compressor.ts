export class MemoryCompressor {
  shouldCompress(_bufferTokens: number): boolean {
    return false;
  }

  async compress(_entries: string[]): Promise<string> {
    throw new Error('Not implemented');
  }
}
