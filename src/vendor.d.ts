// Minimal ambient type declarations for optional dependencies
// that do not ship TypeScript definitions.

// sql.js: used as fallback SQLite backend when node:sqlite is unavailable (Node <22).
declare module 'sql.js' {
  interface SqlJsStatement {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  interface SqlJsDatabase {
    exec(sql: string): void;
    run(sql: string, params?: unknown[]): void;
    prepare(sql: string): SqlJsStatement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
  export default initSqlJs;
}
