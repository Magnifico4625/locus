import { describe, expect, it } from 'vitest';
import { NodeSqliteAdapter } from '../../src/storage/node-sqlite.js';

describe('NodeSqliteAdapter SQLITE_BUSY retry', () => {
  it('retries transient SQLITE_BUSY / database is locked errors across exec/run/get/all', () => {
    let execCalls = 0;
    let runCalls = 0;
    let getCalls = 0;
    let allCalls = 0;

    const fakeDb = {
      exec() {
        execCalls++;
        if (execCalls < 3) {
          throw new Error('SQLITE_BUSY: database is locked');
        }
      },
      prepare() {
        return {
          run() {
            runCalls++;
            if (runCalls < 2) {
              throw new Error('database is locked');
            }
            return { changes: 1, lastInsertRowid: 42 };
          },
          get() {
            getCalls++;
            if (getCalls < 2) {
              throw new Error('SQLITE_BUSY');
            }
            return { id: 42 };
          },
          all() {
            allCalls++;
            if (allCalls < 3) {
              throw new Error('SQLITE_BUSY: locked');
            }
            return [{ id: 1 }];
          },
        };
      },
      close() {},
    };

    const adapter = new NodeSqliteAdapter(fakeDb);
    adapter.exec('SELECT 1');
    expect(execCalls).toBe(3);

    expect(adapter.run('INSERT INTO t VALUES (1)', [1])).toEqual({
      changes: 1,
      lastInsertRowid: 42,
    });
    expect(runCalls).toBe(2);

    expect(adapter.get<{ id: number }>('SELECT * FROM t')).toEqual({ id: 42 });
    expect(getCalls).toBe(2);

    expect(adapter.all<{ id: number }>('SELECT * FROM t')).toEqual([{ id: 1 }]);
    expect(allCalls).toBe(3);
  });

  it('rethrows after exhausting retries and does not retry non-busy errors', () => {
    let busyAttempts = 0;
    let syntaxAttempts = 0;

    const adapter = new NodeSqliteAdapter({
      exec(sql: string) {
        if (sql === 'BUSY') {
          busyAttempts++;
          throw new Error('SQLITE_BUSY: database is locked');
        }
        syntaxAttempts++;
        throw new Error('near "BAD": syntax error');
      },
      prepare() {
        throw new Error('unused');
      },
      close() {},
    });

    expect(() => adapter.exec('BUSY')).toThrow('SQLITE_BUSY');
    expect(busyAttempts).toBe(4); // 1 initial + 3 retries

    expect(() => adapter.exec('BAD')).toThrow('syntax error');
    expect(syntaxAttempts).toBe(1);
  });
});
