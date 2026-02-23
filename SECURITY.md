# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, please use one of the following methods:

1. **GitHub Private Vulnerability Reporting** (preferred):
   Go to [Security Advisories](https://github.com/Magnifico4625/locus/security/advisories) and click "Report a vulnerability".

2. **Email**: Send details to vozol81@mail.ru with the subject "Locus Security Report".

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You should receive a response within 48 hours. Critical vulnerabilities will be patched and released as soon as possible.

## Security Model

Locus uses a 4-layer security model:

1. **Metadata-only** — by default, only file paths, exports, and imports are stored. No raw file content is written to disk.
2. **File denylist** — `.env`, `*.key`, `credentials.*`, and other sensitive patterns are never indexed.
3. **Content redaction** — passwords, API keys, and tokens are automatically stripped before storage.
4. **Audit UX** — the `memory_audit` tool shows exactly what is stored and flags security concerns.

## Scope

The following are in scope for security reports:

- Data leakage (file content stored when it shouldn't be)
- Denylist bypass (sensitive files indexed despite patterns)
- Redaction failure (secrets not stripped from stored content)
- SQLite injection via MCP tool parameters
- Path traversal in `memory_explore` or scanner
- Hook command injection

The following are out of scope:

- Vulnerabilities in Node.js, SQLite, or other upstream dependencies (report to those projects)
- Issues requiring physical access to the machine where Locus runs
- Social engineering
