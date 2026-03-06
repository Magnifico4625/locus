import type {
  CaptureLevel,
  DatabaseAdapter,
  DoctorCheck,
  DoctorReport,
  ProjectRootMethod,
} from '../types.js';

export interface DoctorDeps {
  nodeVersion: string;
  backend: 'node:sqlite' | 'sql.js';
  fts5: boolean;
  dbPath: string;
  projectRoot: string;
  projectRootMethod: ProjectRootMethod;
  captureLevel: CaptureLevel;
  logPath: string;
  db: DatabaseAdapter;
  // Override for testing
  checkDbWritable?: () => boolean;
  checkGitAvailable?: () => boolean;
  checkDiskSpaceMb?: () => number;
  checkLogWritable?: () => boolean;
}

function tableExistsCheck(db: DatabaseAdapter, name: string): boolean {
  const row = db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  );
  return (row?.cnt ?? 0) > 0;
}

export function handleDoctor(deps: DoctorDeps): DoctorReport {
  const checks: DoctorCheck[] = [];

  // 1. Node.js version
  const nodeVer = deps.nodeVersion;
  const major = Number.parseInt(nodeVer.replace('v', '').split('.')[0] ?? '0', 10);
  if (major >= 22) {
    checks.push({
      name: 'Node.js',
      status: 'ok',
      message: `${nodeVer} (>= 22, node:sqlite available)`,
    });
  } else if (major >= 20) {
    checks.push({
      name: 'Node.js',
      status: 'ok',
      message: `${nodeVer} (>= 20, sql.js fallback)`,
    });
  } else {
    checks.push({
      name: 'Node.js',
      status: 'fail',
      message: `${nodeVer} (< 20, unsupported)`,
      fix: 'Upgrade to Node.js 20+',
    });
  }

  // 2. Storage backend
  if (deps.backend === 'node:sqlite') {
    checks.push({ name: 'Storage backend', status: 'ok', message: 'node:sqlite' });
  } else {
    checks.push({
      name: 'Storage backend',
      status: 'warn',
      message: 'sql.js (upgrade to Node 22+ for native sqlite)',
      fix: 'Upgrade to Node.js 22+',
    });
  }

  // 3. FTS5
  if (deps.fts5) {
    checks.push({ name: 'FTS5', status: 'ok', message: 'available (full-text search enabled)' });

    // 3a. Check memories_fts index health
    const hasMemoFts = tableExistsCheck(deps.db, 'memories_fts');
    const memoCount =
      deps.db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM memories')?.cnt ?? 0;
    if (!hasMemoFts) {
      checks.push({
        name: 'FTS5 memories index',
        status: 'fail',
        message: 'memories_fts table missing',
        fix: 'Restart MCP server — ensureFts() will auto-create and rebuild',
      });
    } else {
      const ftsCount =
        deps.db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM memories_fts')?.cnt ?? 0;
      if (memoCount > 0 && ftsCount === 0) {
        checks.push({
          name: 'FTS5 memories index',
          status: 'fail',
          message: `index empty (${memoCount} memories exist but 0 indexed)`,
          fix: 'Restart MCP server — ensureFts() will auto-rebuild',
        });
      } else {
        checks.push({
          name: 'FTS5 memories index',
          status: 'ok',
          message: `${ftsCount} entries indexed (${memoCount} total memories)`,
        });
      }
    }

    // 3b. Check conversation_fts index health
    const hasConvFts = tableExistsCheck(deps.db, 'conversation_fts');
    const ceCount =
      deps.db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_events')?.cnt ?? 0;
    if (!hasConvFts) {
      checks.push({
        name: 'FTS5 conversation index',
        status: 'fail',
        message: 'conversation_fts table missing',
        fix: 'Restart MCP server — ensureFts() will auto-create and rebuild',
      });
    } else {
      const cftsCount =
        deps.db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM conversation_fts')?.cnt ?? 0;
      if (ceCount > 0 && cftsCount === 0) {
        checks.push({
          name: 'FTS5 conversation index',
          status: 'warn',
          message: `index empty (${ceCount} events exist but 0 indexed)`,
          fix: 'Restart MCP server — ensureFts() will auto-rebuild',
        });
      } else {
        checks.push({
          name: 'FTS5 conversation index',
          status: 'ok',
          message: `${cftsCount}/${ceCount} events indexed`,
        });
      }
    }
  } else {
    checks.push({
      name: 'FTS5',
      status: 'warn',
      message: 'not available (using LIKE fallback)',
      fix: 'Depends on Node.js SQLite build. Search still works via LIKE fallback.',
    });
  }

  // 4. DB writable
  const dbWritable = deps.checkDbWritable ? deps.checkDbWritable() : true;
  if (dbWritable) {
    checks.push({ name: 'DB writable', status: 'ok', message: `${deps.dbPath}` });
  } else {
    checks.push({
      name: 'DB writable',
      status: 'fail',
      message: `${deps.dbPath} — not writable`,
      fix: 'Check directory permissions',
    });
  }

  // 5. Project root
  checks.push({
    name: 'Project root',
    status: 'ok',
    message: `${deps.projectRoot} (detected via ${deps.projectRootMethod})`,
  });

  // 6. Git available
  const gitAvailable = deps.checkGitAvailable ? deps.checkGitAvailable() : true;
  checks.push(
    gitAvailable
      ? { name: 'Git', status: 'ok', message: 'available (incremental scan via git diff)' }
      : {
          name: 'Git',
          status: 'warn',
          message: 'not available (using mtime-based scan)',
          fix: 'Install git for faster incremental scans',
        },
  );

  // 7. Capture level
  if (deps.captureLevel === 'metadata') {
    checks.push({
      name: 'Capture level',
      status: 'ok',
      message: 'metadata (default, no raw content stored)',
    });
  } else if (deps.captureLevel === 'full') {
    checks.push({
      name: 'Capture level',
      status: 'warn',
      message: 'full (WARNING: raw content is being stored!)',
      fix: 'Set captureLevel to "metadata" or "redacted"',
    });
  } else {
    checks.push({
      name: 'Capture level',
      status: 'ok',
      message: `${deps.captureLevel}`,
    });
  }

  // 8. Disk space
  const diskMb = deps.checkDiskSpaceMb ? deps.checkDiskSpaceMb() : 1000;
  if (diskMb < 100) {
    checks.push({
      name: 'Disk space',
      status: 'warn',
      message: `${diskMb} MB free`,
      fix: 'Free up disk space',
    });
  } else {
    checks.push({ name: 'Disk space', status: 'ok', message: `${diskMb} MB free` });
  }

  // 9. Log file writable
  const logWritable = deps.checkLogWritable ? deps.checkLogWritable() : true;
  checks.push(
    logWritable
      ? { name: 'Log file', status: 'ok', message: deps.logPath }
      : {
          name: 'Log file',
          status: 'warn',
          message: `${deps.logPath} — not writable`,
          fix: 'Check log directory permissions',
        },
  );

  // 10. Scanner state
  const fileCount = deps.db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM files')?.cnt ?? 0;
  const skippedCount =
    deps.db.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM files WHERE skipped_reason IS NOT NULL',
    )?.cnt ?? 0;
  const lastScanRow = deps.db.get<{ value: string }>('SELECT value FROM scan_state WHERE key = ?', [
    'lastScan',
  ]);

  if (fileCount > 0) {
    checks.push({
      name: 'Scanner',
      status: 'ok',
      message: `${fileCount} files indexed, ${skippedCount} skipped`,
    });
  } else if (lastScanRow) {
    checks.push({ name: 'Scanner', status: 'warn', message: 'Last scan found no files' });
  } else {
    checks.push({
      name: 'Scanner',
      status: 'warn',
      message: 'No scan performed yet',
      fix: 'Run memory_scan() to index project',
    });
  }

  // Summarize
  let passed = 0;
  let warnings = 0;
  let failures = 0;
  for (const c of checks) {
    if (c.status === 'ok') passed++;
    else if (c.status === 'warn') warnings++;
    else failures++;
  }

  return { checks, passed, warnings, failures };
}
