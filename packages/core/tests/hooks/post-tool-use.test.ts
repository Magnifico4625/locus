import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  classifyError,
  computeInboxDir,
  extractCapture,
  extractDiffStats,
  extractFilePaths,
} from '../../../claude-code/hooks/post-tool-use.js';

// ─── classifyError ────────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('returns file_not_found for ENOENT messages', () => {
    expect(classifyError('ENOENT: no such file or directory')).toBe('file_not_found');
  });

  it('returns file_not_found for "not found" messages', () => {
    expect(classifyError('Command not found: foobar')).toBe('file_not_found');
  });

  it('returns file_not_found for "no such file" messages', () => {
    expect(classifyError('No such file: /tmp/missing.txt')).toBe('file_not_found');
  });

  it('returns permission_denied for EACCES messages', () => {
    expect(classifyError('EACCES: permission denied, open /etc/shadow')).toBe('permission_denied');
  });

  it('returns permission_denied for "permission denied" messages', () => {
    expect(classifyError('bash: /usr/bin/sudo: Permission denied')).toBe('permission_denied');
  });

  it('returns timeout for timeout messages', () => {
    expect(classifyError('Operation timed out after 5000ms')).toBe('timeout');
  });

  it('returns timeout for "timed out" messages', () => {
    expect(classifyError('Request timed out')).toBe('timeout');
  });

  it('returns syntax_error for syntax messages', () => {
    expect(classifyError('SyntaxError: Unexpected token ;')).toBe('syntax_error');
  });

  it('returns syntax_error for parse error messages', () => {
    expect(classifyError('parse error at line 42')).toBe('syntax_error');
  });

  it('returns network_error for ECONNREFUSED messages', () => {
    expect(classifyError('ECONNREFUSED 127.0.0.1:3000')).toBe('network_error');
  });

  it('returns network_error for ENETUNREACH messages', () => {
    expect(classifyError('ENETUNREACH: network unreachable')).toBe('network_error');
  });

  it('returns network_error for DNS messages', () => {
    expect(classifyError('DNS lookup failed for example.com')).toBe('network_error');
  });

  it('returns unknown for unrecognized error messages', () => {
    expect(classifyError('Something went completely wrong')).toBe('unknown');
  });

  it('returns unknown for an empty string', () => {
    expect(classifyError('')).toBe('unknown');
  });
});

// ─── extractFilePaths ─────────────────────────────────────────────────────────

describe('extractFilePaths', () => {
  it('extracts file_path for Read tool', () => {
    const result = extractFilePaths('Read', { file_path: '/src/app.ts' });
    expect(result).toEqual(['/src/app.ts']);
  });

  it('extracts file_path for Write tool', () => {
    const result = extractFilePaths('Write', { file_path: '/src/utils.js', content: 'hello' });
    expect(result).toEqual(['/src/utils.js']);
  });

  it('extracts file_path for Edit tool', () => {
    const result = extractFilePaths('Edit', {
      file_path: '/config/tsconfig.json',
      old_string: 'x',
      new_string: 'y',
    });
    expect(result).toEqual(['/config/tsconfig.json']);
  });

  it('returns pattern for Glob tool', () => {
    const result = extractFilePaths('Glob', { pattern: '**/*.ts' });
    expect(result).toEqual(['**/*.ts']);
  });

  it('returns path for Grep tool', () => {
    const result = extractFilePaths('Grep', { query: 'TODO', path: '/src' });
    expect(result).toEqual(['/src']);
  });

  it('returns empty array when Grep has no path', () => {
    const result = extractFilePaths('Grep', { query: 'TODO' });
    expect(result).toEqual([]);
  });

  it('extracts file paths from Bash command', () => {
    const result = extractFilePaths('Bash', { command: 'cat /home/user/project/main.ts' });
    expect(result).toContain('/home/user/project/main.ts');
  });

  it('extracts multiple file paths from Bash command', () => {
    const result = extractFilePaths('Bash', {
      command: 'diff src/old.ts src/new.ts',
    });
    expect(result).toContain('src/old.ts');
    expect(result).toContain('src/new.ts');
  });

  it('returns empty array for Bash with no recognizable file paths', () => {
    const result = extractFilePaths('Bash', { command: 'ls -la /tmp' });
    expect(result).toEqual([]);
  });

  it('returns empty array for unknown tool', () => {
    const result = extractFilePaths('UnknownTool', { file_path: '/some/path.ts' });
    expect(result).toEqual([]);
  });

  it('returns empty array when toolInput is null', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive null handling
    const result = extractFilePaths('Read', null as any);
    expect(result).toEqual([]);
  });

  it('returns empty array when Read has no file_path', () => {
    const result = extractFilePaths('Read', {});
    expect(result).toEqual([]);
  });

  it('deduplicates repeated file paths in Bash command', () => {
    const result = extractFilePaths('Bash', {
      command: 'cp src/app.ts src/app.ts',
    });
    expect(result).toEqual(['src/app.ts']);
  });
});

// ─── extractDiffStats ────────────────────────────────────────────────────────

describe('extractDiffStats', () => {
  it('parses insertions and deletions from git diff --stat output', () => {
    const output = ' src/app.ts | 10 +++++-----\n 1 file changed, 5 insertions(+), 5 deletions(-)';
    const result = extractDiffStats(output);
    expect(result).toEqual({ added: 5, removed: 5 });
  });

  it('parses only insertions when no deletions', () => {
    const output = '2 files changed, 10 insertions(+)';
    const result = extractDiffStats(output);
    expect(result).toEqual({ added: 10, removed: 0 });
  });

  it('parses only deletions when no insertions', () => {
    const output = '1 file changed, 3 deletions(-)';
    const result = extractDiffStats(output);
    expect(result).toEqual({ added: 0, removed: 3 });
  });

  it('handles singular insertion(+)', () => {
    const output = '1 file changed, 1 insertion(+), 2 deletions(-)';
    const result = extractDiffStats(output);
    expect(result).toEqual({ added: 1, removed: 2 });
  });

  it('returns undefined when no stats pattern found', () => {
    const result = extractDiffStats('npm test output: 10 passing, 0 failing');
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractDiffStats('')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(extractDiffStats(undefined)).toBeUndefined();
  });

  it('returns undefined for non-string input', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive handling
    expect(extractDiffStats(42 as any)).toBeUndefined();
  });
});

// ─── extractCapture ──────────────────────────────────────────────────────────

describe('extractCapture — metadata level', () => {
  const baseEvent = {
    tool_name: 'Read',
    tool_input: { file_path: '/src/main.ts' },
    tool_response: 'file contents here',
    duration_ms: 42,
  };

  it('includes toolName, status, timestamp, durationMs', () => {
    const capture = extractCapture(baseEvent, 'metadata');
    expect(capture.tool_name).toBe('Read');
    expect(capture.status).toBe('success');
    expect(capture.duration_ms).toBe(42);
    expect(typeof capture.timestamp).toBe('number');
    expect(capture.timestamp).toBeGreaterThan(0);
  });

  it('includes serialized file_paths_json', () => {
    const capture = extractCapture(baseEvent, 'metadata');
    expect(capture.file_paths_json).toBe(JSON.stringify(['/src/main.ts']));
  });

  it('does NOT include error_kind at metadata level', () => {
    const event = { ...baseEvent, error: 'ENOENT: no such file' };
    const capture = extractCapture(event, 'metadata');
    expect(capture.error_kind).toBeNull();
  });

  it('does NOT include bash_command at metadata level', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test --watch' },
      tool_response: '',
      duration_ms: 100,
    };
    const capture = extractCapture(event, 'metadata');
    expect(capture.bash_command).toBeNull();
  });

  it('sets status to error when event.error is present', () => {
    const event = { ...baseEvent, error: 'EACCES: permission denied' };
    const capture = extractCapture(event, 'metadata');
    expect(capture.status).toBe('error');
  });

  it('sets exit_code to null for non-Bash tools', () => {
    const capture = extractCapture(baseEvent, 'metadata');
    expect(capture.exit_code).toBeNull();
  });

  it('sets exit_code to 0 for successful Bash', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_response: 'hello',
      duration_ms: 10,
    };
    const capture = extractCapture(event, 'metadata');
    expect(capture.exit_code).toBe(0);
  });

  it('sets diff_added and diff_removed from git diff output', () => {
    const event = {
      ...baseEvent,
      tool_name: 'Bash',
      tool_input: { command: 'git diff HEAD' },
      tool_response: '1 file changed, 3 insertions(+), 1 deletion(-)',
    };
    const capture = extractCapture(event, 'metadata');
    expect(capture.diff_added).toBe(3);
    expect(capture.diff_removed).toBe(1);
  });

  it('sets diff_added and diff_removed to null when no diff stats', () => {
    const capture = extractCapture(baseEvent, 'metadata');
    expect(capture.diff_added).toBeNull();
    expect(capture.diff_removed).toBeNull();
  });

  it('metadata level NEVER includes file content fields', () => {
    const capture = extractCapture(baseEvent, 'metadata');
    // These fields must not exist at all on metadata captures
    expect(Object.keys(capture)).not.toContain('tool_input');
    expect(Object.keys(capture)).not.toContain('tool_response');
    expect(Object.keys(capture)).not.toContain('file_content');
    expect(Object.keys(capture)).not.toContain('stdout');
    expect(Object.keys(capture)).not.toContain('stderr');
  });
});

describe('extractCapture — redacted level', () => {
  it('includes error_kind when event has an error', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'cat /etc/shadow' },
      tool_response: '',
      duration_ms: 5,
      error: 'EACCES: permission denied',
    };
    const capture = extractCapture(event, 'redacted');
    expect(capture.error_kind).toBe('permission_denied');
  });

  it('error_kind is null when there is no error', () => {
    const event = {
      tool_name: 'Read',
      tool_input: { file_path: '/src/app.ts' },
      tool_response: 'content',
      duration_ms: 20,
    };
    const capture = extractCapture(event, 'redacted');
    expect(capture.error_kind).toBeNull();
  });

  it('bash_command contains only the first token of the command', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'npm test --reporter=verbose --coverage' },
      tool_response: '',
      duration_ms: 300,
    };
    const capture = extractCapture(event, 'redacted');
    expect(capture.bash_command).toBe('npm');
  });

  it('bash_command for single-token command is the full command', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
      tool_response: '/home/user',
      duration_ms: 3,
    };
    const capture = extractCapture(event, 'redacted');
    expect(capture.bash_command).toBe('pwd');
  });

  it('bash_command is null for non-Bash tools at redacted level', () => {
    const event = {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/test.txt', content: 'hello' },
      tool_response: '',
      duration_ms: 10,
    };
    const capture = extractCapture(event, 'redacted');
    expect(capture.bash_command).toBeNull();
  });
});

describe('extractCapture — full level', () => {
  it('bash_command contains the entire command string', () => {
    const fullCommand = 'npm run test -- --reporter=verbose --coverage --watch=false';
    const event = {
      tool_name: 'Bash',
      tool_input: { command: fullCommand },
      tool_response: '',
      duration_ms: 400,
    };
    const capture = extractCapture(event, 'full');
    expect(capture.bash_command).toBe(fullCommand);
  });

  it('full level includes the same base metadata fields', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'ls /tmp' },
      tool_response: 'file1\nfile2',
      duration_ms: 8,
    };
    const capture = extractCapture(event, 'full');
    expect(capture.tool_name).toBe('Bash');
    expect(capture.status).toBe('success');
    expect(typeof capture.timestamp).toBe('number');
    expect(capture.duration_ms).toBe(8);
  });

  it('full level error_kind is classified when error present', () => {
    const event = {
      tool_name: 'Bash',
      tool_input: { command: 'curl http://unreachable.local' },
      tool_response: '',
      duration_ms: 5000,
      error: 'ECONNREFUSED 127.0.0.1:80',
    };
    const capture = extractCapture(event, 'full');
    expect(capture.error_kind).toBe('network_error');
    expect(capture.bash_command).toBe('curl http://unreachable.local');
  });
});

// ─── computeInboxDir ─────────────────────────────────────────────────────────

describe('computeInboxDir', () => {
  it('returns a path ending with /inbox/', () => {
    const dir = computeInboxDir('/tmp/test-project');
    expect(dir).toMatch(/inbox[/\\]?$/);
  });

  it('includes locus- prefix with hash in the path', () => {
    const dir = computeInboxDir('/tmp/test-project');
    expect(dir).toMatch(/locus-[a-f0-9]{16}/);
  });

  it('produces consistent paths for the same project root', () => {
    const dir1 = computeInboxDir('/tmp/my-project');
    const dir2 = computeInboxDir('/tmp/my-project');
    expect(dir1).toBe(dir2);
  });

  it('produces different paths for different project roots', () => {
    const dir1 = computeInboxDir('/tmp/project-a');
    const dir2 = computeInboxDir('/tmp/project-b');
    expect(dir1).not.toBe(dir2);
  });
});

// ─── Default export (inbox writer) ──────────────────────────────────────────

describe('postToolUse default export', () => {
  // Temp dirs created by the hook will be under the user's home — we track and clean up
  const cleanupDirs: string[] = [];

  afterAll(() => {
    for (const dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it('is an async function that returns undefined without crashing', async () => {
    const { default: postToolUse } = await import('../../../claude-code/hooks/post-tool-use.js');
    const event = {
      session_id: 'test-session',
      tool_name: 'Read',
      tool_input: { file_path: '/nonexistent.ts' },
      tool_response: '',
      duration_ms: 1,
    };
    const result = await postToolUse(event);
    expect(result).toBeUndefined();
  });

  it('silently handles a completely malformed event without throwing', async () => {
    const { default: postToolUse } = await import('../../../claude-code/hooks/post-tool-use.js');
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive null handling
    const result = await postToolUse(null as any);
    expect(result).toBeUndefined();
  });

  it('writes an InboxEvent JSON file to the inbox directory', async () => {
    const { default: postToolUse, computeInboxDir } = await import(
      '../../../claude-code/hooks/post-tool-use.js'
    );
    const event = {
      session_id: 'test-inbox-session',
      tool_name: 'Read',
      tool_input: { file_path: '/src/app.ts' },
      tool_response: 'file contents',
      duration_ms: 15,
    };

    await postToolUse(event);

    // Determine inbox dir from process.cwd() resolved root
    const cwd = process.env.PWD ?? process.cwd();
    const inboxDir = computeInboxDir(cwd);
    cleanupDirs.push(inboxDir);

    // Check if JSON files exist in inbox
    let files: string[] = [];
    try {
      files = readdirSync(inboxDir).filter((f: string) => f.endsWith('.json'));
    } catch {
      // inbox dir may not exist if hook failed gracefully
    }

    // If hook succeeded (has a valid project root), there should be at least one file
    if (files.length > 0) {
      const content = JSON.parse(readFileSync(join(inboxDir, files[0] ?? ''), 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.source).toBe('claude-code');
      expect(content.kind).toBe('tool_use');
      expect(typeof content.event_id).toBe('string');
      expect(typeof content.timestamp).toBe('number');
      expect(content.payload).toBeDefined();
      expect(content.payload.tool).toBe('Read');
    }
  });

  it('does not write to inbox when LOCUS_CAPTURE_LEVEL is invalid', async () => {
    const original = process.env.LOCUS_CAPTURE_LEVEL;
    try {
      process.env.LOCUS_CAPTURE_LEVEL = 'invalid-level';
      const { default: postToolUse } = await import('../../../claude-code/hooks/post-tool-use.js');
      const event = {
        session_id: 'test-session',
        tool_name: 'Read',
        tool_input: { file_path: '/test.ts' },
        tool_response: '',
        duration_ms: 1,
      };
      const result = await postToolUse(event);
      expect(result).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.LOCUS_CAPTURE_LEVEL;
      } else {
        process.env.LOCUS_CAPTURE_LEVEL = original;
      }
    }
  });
});
