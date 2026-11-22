#!/usr/bin/env node

// packages/cli/src/index.ts
import { fileURLToPath as fileURLToPath7 } from "node:url";

// packages/core/src/context/auto-brief.ts
import { basename } from "node:path";

// packages/shared-runtime/detect-client.js
var EXPLICIT_CLIENTS = /* @__PURE__ */ new Set(["claude-code", "codex", "antigravity", "opencode", "dsh"]);
var VALID_SURFACES = /* @__PURE__ */ new Set(["cli", "desktop", "extension"]);
function detectClientRuntime(env = process.env, _argv = process.argv, _cwd = process.cwd()) {
  const explicitClient = env.LOCUS_CLIENT?.trim();
  if (explicitClient && EXPLICIT_CLIENTS.has(explicitClient)) {
    const client = (
      /** @type {Exclude<ClientEnv, 'generic'>} */
      explicitClient
    );
    const defaultSurface = client === "antigravity" || client === "opencode" || client === "dsh" ? "desktop" : "cli";
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, defaultSurface, client === "codex");
    return {
      client,
      surface,
      detected: true,
      evidence: [`env:LOCUS_CLIENT=${client}`, ...evidenceKey ? [evidenceKey] : []]
    };
  }
  if (hasNonEmptyValue(env.LOCUS_ANTIGRAVITY)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, "desktop", false);
    return {
      client: "antigravity",
      surface,
      detected: true,
      evidence: ["env:LOCUS_ANTIGRAVITY", ...evidenceKey ? [evidenceKey] : []]
    };
  }
  if (hasNonEmptyValue(env.LOCUS_OPENCODE)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, "desktop", false);
    return {
      client: "opencode",
      surface,
      detected: true,
      evidence: ["env:LOCUS_OPENCODE", ...evidenceKey ? [evidenceKey] : []]
    };
  }
  if (hasNonEmptyValue(env.LOCUS_DSH)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, "desktop", false);
    return {
      client: "dsh",
      surface,
      detected: true,
      evidence: ["env:LOCUS_DSH", ...evidenceKey ? [evidenceKey] : []]
    };
  }
  if (hasNonEmptyValue(env.CODEX_HOME)) {
    const { surface, evidenceKey } = resolveSurfaceFromEnv(env, "cli", true);
    return {
      client: "codex",
      surface,
      detected: true,
      evidence: ["env:CODEX_HOME", ...evidenceKey ? [evidenceKey] : []]
    };
  }
  if (hasNonEmptyValue(env.CLAUDE_PLUGIN_ROOT)) {
    return {
      client: "claude-code",
      surface: "cli",
      detected: true,
      evidence: ["env:CLAUDE_PLUGIN_ROOT"]
    };
  }
  return {
    client: "generic",
    surface: "generic",
    detected: false,
    evidence: ["fallback:generic"]
  };
}
function detectClientEnv() {
  return detectClientRuntime().client;
}
function hasNonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function resolveSurfaceFromEnv(env, defaultSurface, includeCodexOverride) {
  const genericSurface = env.LOCUS_CLIENT_SURFACE;
  if (genericSurface && VALID_SURFACES.has(genericSurface)) {
    return {
      surface: (
        /** @type {ClientSurface} */
        genericSurface
      ),
      evidenceKey: `env:LOCUS_CLIENT_SURFACE=${genericSurface}`
    };
  }
  if (includeCodexOverride) {
    const codexSurface = env.LOCUS_CODEX_SURFACE;
    if (codexSurface && VALID_SURFACES.has(codexSurface)) {
      return {
        surface: (
          /** @type {ClientSurface} */
          codexSurface
        ),
        evidenceKey: `env:LOCUS_CODEX_SURFACE=${codexSurface}`
      };
    }
  }
  return {
    surface: (
      /** @type {ClientSurface} */
      defaultSurface
    ),
    evidenceKey: void 0
  };
}

// packages/shared-runtime/normalize-path.js
import { normalize } from "node:path";
import { fileURLToPath } from "node:url";
function normalizePathForIdentity(pathValue) {
  let value = pathValue.trim();
  if (/^file:\/\//i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = value.replace(/^file:\/\/(?:localhost)?/i, "");
      if (/^\/[a-zA-Z]:[\\/]/.test(value)) {
        value = value.slice(1);
      }
    }
  }
  let isUnc = false;
  if (/^(?:\\\\\?\\|\/\/\?\/)UNC[\\/]/i.test(value)) {
    value = value.replace(/^(?:\\\\\?\\|\/\/\?\/)UNC[\\/]/i, "\\\\");
    isUnc = true;
  } else if (/^(?:\\\\\?\\|\/\/\?\/)(?=[a-zA-Z]:[\\/])/u.test(value)) {
    value = value.replace(/^(?:\\\\\?\\|\/\/\?\/)/u, "");
  } else if (/^(?:\\\\|\/\/)[^?/\\]/u.test(value)) {
    isUnc = true;
  }
  let normalized = normalize(value).replace(/\\/g, "/");
  if (isUnc) {
    const withoutLeading = normalized.replace(/^\/+/u, "");
    normalized = `//${withoutLeading.replace(/\/+/gu, "/")}`;
  } else {
    normalized = normalized.replace(/\/+/gu, "/");
  }
  normalized = normalized.toLowerCase();
  if (normalized !== "/" && !/^[a-z]:\/$/u.test(normalized)) {
    normalized = normalized.replace(/\/+$/u, "");
  }
  return normalized;
}

// packages/shared-runtime/project-hash.js
import { createHash } from "node:crypto";
function projectHash(projectRoot) {
  const normalized = normalizePathForIdentity(projectRoot);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// packages/shared-runtime/resolve-storage.js
import { homedir } from "node:os";
import { join } from "node:path";
function expandTilde(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}
function resolveLocusHome(env = process.env) {
  const override = env.LOCUS_HOME?.trim();
  if (override && override.length > 0) {
    return expandTilde(override);
  }
  return join(homedir(), ".locus");
}
function resolveRuntimeBinDir(env = process.env) {
  return join(resolveLocusHome(env), "bin");
}
function resolveStorageRoot() {
  if (process.env.LOCUS_STORAGE_ROOT) {
    return expandTilde(process.env.LOCUS_STORAGE_ROOT);
  }
  const client = detectClientEnv();
  const home = homedir();
  if (client === "codex") {
    return join(expandTilde(process.env.CODEX_HOME), "memory");
  }
  if (client === "claude-code") {
    return join(home, ".claude", "memory");
  }
  return join(home, ".locus", "memory");
}
function resolveProjectStorageDir(projectRoot) {
  return join(resolveStorageRoot(), `locus-${projectHash(projectRoot)}`);
}
function resolveDbPath(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), "locus.db");
}
function resolveInboxDir(projectRoot) {
  return join(resolveProjectStorageDir(projectRoot), "inbox");
}

// packages/core/src/recall/project-scope.ts
function normalizeProjectRootForScope(projectRoot) {
  const normalized = normalizePathForIdentity(projectRoot.trim());
  if (normalized === "/" || /^[a-z]:\/$/u.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/$/u, "");
}
function isSameProjectRoot(left, right) {
  if (!left) {
    return false;
  }
  return normalizeProjectRootForScope(left) === normalizeProjectRootForScope(right);
}
function buildProjectScopeClause(column, projectRoot, options) {
  const normalized = normalizeProjectRootForScope(projectRoot);
  if (options?.includeLegacyGlobal) {
    return {
      clause: `(${column} = ? OR ${column} IS NULL)`,
      params: [normalized]
    };
  }
  return {
    clause: `${column} = ?`,
    params: [normalized]
  };
}

// packages/core/src/utils.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function sanitizeFtsQuery(query) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" ");
}

// packages/core/src/tools/search.ts
function summarizePayload(kind, payloadJson) {
  if (!payloadJson) return kind;
  try {
    const payload = JSON.parse(payloadJson);
    switch (kind) {
      case "user_prompt": {
        const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
        return prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
      }
      case "ai_response": {
        const response = typeof payload.response === "string" ? payload.response : "";
        return response.length > 120 ? `${response.slice(0, 117)}...` : response;
      }
      case "tool_use": {
        const tool = typeof payload.tool === "string" ? payload.tool : "";
        const files = Array.isArray(payload.files) ? payload.files : [];
        const status = typeof payload.status === "string" ? payload.status : "";
        const fileStr = files.length > 0 ? ` [${files.join(", ")}]` : "";
        return `${tool}${fileStr} (${status})`;
      }
      case "file_diff": {
        const path = typeof payload.path === "string" ? payload.path : "";
        const added = typeof payload.added === "number" ? payload.added : 0;
        const removed = typeof payload.removed === "number" ? payload.removed : 0;
        return `${path} (+${added}/-${removed})`;
      }
      case "session_start": {
        const tool = typeof payload.tool === "string" ? payload.tool : "";
        return `session_start: ${tool}`;
      }
      case "session_end": {
        const summary = typeof payload.summary === "string" ? payload.summary : "";
        return summary ? `session_end: ${summary}` : "session_end";
      }
      default:
        return kind;
    }
  } catch {
    return kind;
  }
}
function setStartOfDay(date, mode) {
  if (mode === "utc") {
    date.setUTCHours(0, 0, 0, 0);
    return;
  }
  date.setHours(0, 0, 0, 0);
}
function startOfMonth(timestamp4, mode) {
  const date = new Date(timestamp4);
  if (mode === "utc") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date, months, mode) {
  const next = new Date(date);
  if (mode === "utc") {
    next.setUTCMonth(next.getUTCMonth() + months);
  } else {
    next.setMonth(next.getMonth() + months);
  }
  return next;
}
function resolveTimeRange(range2, referenceNow, mode = "local") {
  const now = referenceNow ?? Date.now();
  if (range2.relative) {
    switch (range2.relative) {
      case "today": {
        const start = new Date(now);
        setStartOfDay(start, mode);
        return { from: start.getTime(), to: now };
      }
      case "yesterday": {
        const startOfToday = new Date(now);
        setStartOfDay(startOfToday, mode);
        const startOfYesterday = new Date(startOfToday);
        if (mode === "utc") {
          startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);
        } else {
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        }
        return { from: startOfYesterday.getTime(), to: startOfToday.getTime() };
      }
      case "this_week": {
        const monday = new Date(now);
        const dayOfWeek = mode === "utc" ? monday.getUTCDay() : monday.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        if (mode === "utc") {
          monday.setUTCDate(monday.getUTCDate() - diff);
        } else {
          monday.setDate(monday.getDate() - diff);
        }
        setStartOfDay(monday, mode);
        return { from: monday.getTime(), to: now };
      }
      case "last_7d":
        return { from: now - 7 * 24 * 3600 * 1e3, to: now };
      case "last_30d":
        return { from: now - 30 * 24 * 3600 * 1e3, to: now };
      case "this_month": {
        const start = startOfMonth(now, mode);
        const end = addMonths(start, 1, mode);
        return { from: start.getTime(), to: end.getTime() };
      }
      case "last_month": {
        const thisMonth = startOfMonth(now, mode);
        const previousMonth = addMonths(thisMonth, -1, mode);
        return { from: previousMonth.getTime(), to: thisMonth.getTime() };
      }
    }
  }
  return {
    from: range2.from ?? 0,
    to: range2.to ?? now
  };
}

// packages/core/src/recall/calendar.ts
function pad2(value) {
  return String(value).padStart(2, "0");
}
function dateKey(timestamp4, mode) {
  const date = new Date(timestamp4);
  const year = mode === "utc" ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === "utc" ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = mode === "utc" ? date.getUTCDate() : date.getDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
function monthKey(timestamp4, mode) {
  const date = new Date(timestamp4);
  const year = mode === "utc" ? date.getUTCFullYear() : date.getFullYear();
  const month = mode === "utc" ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  return `${year}-${pad2(month)}`;
}
function startOfDay(timestamp4, options) {
  const mode = options?.mode ?? "local";
  const date = new Date(timestamp4);
  if (mode === "utc") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
function addDays(timestamp4, days, mode) {
  const date = new Date(timestamp4);
  if (mode === "utc") {
    date.setUTCDate(date.getUTCDate() + days);
  } else {
    date.setDate(date.getDate() + days);
  }
  return date.getTime();
}
function startOfMonth2(timestamp4, mode) {
  const date = new Date(timestamp4);
  if (mode === "utc") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}
function addMonths2(timestamp4, months, mode) {
  const date = new Date(timestamp4);
  if (mode === "utc") {
    date.setUTCMonth(date.getUTCMonth() + months);
  } else {
    date.setMonth(date.getMonth() + months);
  }
  return date.getTime();
}
function dayBucket(timestamp4, options) {
  const mode = options?.mode ?? "local";
  const from = startOfDay(timestamp4, { mode });
  const to = addDays(from, 1, mode);
  const key = dateKey(from, mode);
  return { key, label: key, from, to };
}
function weekBucket(timestamp4, options) {
  const mode = options?.mode ?? "local";
  const dayStart = startOfDay(timestamp4, { mode });
  const date = new Date(dayStart);
  const day = mode === "utc" ? date.getUTCDay() : date.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  const from = addDays(dayStart, -mondayOffset, mode);
  const to = addDays(from, 7, mode);
  const key = `${dateKey(from, mode)}/week`;
  return { key, label: key, from, to };
}
function monthBucket(timestamp4, options) {
  const mode = options?.mode ?? "local";
  const from = startOfMonth2(timestamp4, mode);
  const to = addMonths2(from, 1, mode);
  const key = monthKey(from, mode);
  return { key, label: key, from, to };
}

// packages/core/src/tools/timeline.ts
function handleTimeline(deps, options) {
  const { db } = deps;
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const isSummary = options?.summary ?? false;
  const clauses = [];
  const params = [];
  if (deps.projectRoot) {
    const scope = buildProjectScopeClause("ce.project_root", deps.projectRoot);
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  if (options?.timeRange) {
    const resolved = resolveTimeRange(options.timeRange, options.now);
    clauses.push("ce.timestamp >= ?");
    params.push(resolved.from);
    clauses.push("ce.timestamp < ?");
    params.push(resolved.to);
  }
  if (options?.kind) {
    clauses.push("ce.kind = ?");
    params.push(options.kind);
  }
  if (options?.filePath) {
    clauses.push("ce.event_id IN (SELECT event_id FROM event_files WHERE file_path = ?)");
    params.push(options.filePath);
  }
  const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `
    SELECT ce.event_id, ce.kind, ce.timestamp, ce.significance,
           ce.session_id, ce.project_root, ce.payload_json
    FROM conversation_events ce
    ${whereStr}
    ORDER BY ce.timestamp DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const rows = db.all(sql, params);
  return rows.map((row) => {
    const entry = {
      eventId: row.event_id,
      kind: row.kind,
      timestamp: row.timestamp,
      significance: row.significance,
      sessionId: row.session_id,
      projectRoot: row.project_root ?? void 0
    };
    if (!isSummary) {
      entry.summary = summarizePayload(row.kind, row.payload_json);
      const files = db.all("SELECT file_path FROM event_files WHERE event_id = ?", [
        row.event_id
      ]);
      if (files.length > 0) {
        entry.files = files.map((f) => f.file_path);
      }
    }
    return entry;
  });
}

// packages/core/src/recall/candidate-loader.ts
var DURABLE_TYPES_BY_INTENT = {
  decision: ["decision"],
  preference_style: ["preference", "style", "constraint"],
  rejected_alternative: ["rejected_alternative"],
  next_step: ["next_step"],
  validation_fact: ["validation_fact"],
  general: [
    "decision",
    "preference",
    "style",
    "constraint",
    "rejected_alternative",
    "next_step",
    "validation_fact"
  ]
};
function normalizeText(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, " ").replace(/\s+/g, " ").trim();
}
function stemLite(term) {
  if (/^ошиб(?:ка|ки|ку|ке|кой|ок|ками)?$/u.test(term)) {
    return "\u043E\u0448\u0438\u0431\u043A";
  }
  return term;
}
function unique(values) {
  return [...new Set(values)];
}
function textTerms(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  const terms = normalized.split(" ");
  return unique([...terms, ...terms.map(stemLite)]);
}
function matchingTerms(text, queryTerms) {
  if (queryTerms.length === 0) {
    return [];
  }
  const textTermSet = new Set(textTerms(text));
  const normalizedText = normalizeText(text);
  return queryTerms.filter((term) => textTermSet.has(term) || normalizedText.includes(term));
}
function shouldKeepByTerms(text, queryTerms) {
  return queryTerms.length === 0 || matchingTerms(text, queryTerms).length > 0;
}
function candidateDateFields(timestamp4) {
  if (timestamp4 === void 0) {
    return {};
  }
  const mode = "local";
  const day = dayBucket(timestamp4, { mode });
  const week = weekBucket(timestamp4, { mode });
  const month = monthBucket(timestamp4, { mode });
  return {
    localDate: day.key,
    weekKey: week.key,
    monthKey: month.key
  };
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function hasExactTermOverlap(content, terms) {
  const normalized = content.toLowerCase();
  return terms.some((term) => {
    const escaped = escapeRegExp(term.toLowerCase());
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}([^\\p{L}\\p{N}_-]|$)`, "u").test(normalized);
  });
}
function durableTypesForIntent(intent) {
  return DURABLE_TYPES_BY_INTENT[intent] ?? [];
}
function isExactDurableIntent(intent) {
  return intent === "rejected_alternative" || intent === "next_step" || intent === "validation_fact";
}
function loadDurableCandidates({
  db,
  parsedQuery,
  timeRange,
  now,
  limit,
  projectRoot,
  includeLegacyGlobal
}) {
  const memoryTypes = durableTypesForIntent(parsedQuery.intent);
  if (memoryTypes.length === 0) {
    return [];
  }
  const params = [];
  const clauses = ["state = ?"];
  params.push("active");
  clauses.push(`memory_type IN (${memoryTypes.map(() => "?").join(", ")})`);
  params.push(...memoryTypes);
  if (projectRoot) {
    const scope = buildProjectScopeClause("project_root", projectRoot, {
      includeLegacyGlobal
    });
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  if (timeRange) {
    const resolved = resolveTimeRange(timeRange, now);
    clauses.push("updated_at >= ?");
    params.push(resolved.from);
    clauses.push("updated_at < ?");
    params.push(resolved.to);
  }
  const rows = db.all(
    `SELECT id, topic_key, memory_type, summary, updated_at, project_root
     FROM durable_memories
     WHERE ${clauses.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );
  return rows.filter((row) => {
    if (parsedQuery.intent === "preference_style" || isExactDurableIntent(parsedQuery.intent)) {
      return true;
    }
    return parsedQuery.topicHints.includes(row.topic_key ?? "") || shouldKeepByTerms(row.summary, parsedQuery.termVariants);
  }).map((row) => ({
    projectRoot: row.project_root ?? void 0,
    headline: row.summary,
    whyMatched: `durable ${row.memory_type} memory`,
    eventIds: [],
    durableMemoryIds: [row.id],
    intent: parsedQuery.intent,
    topicKey: row.topic_key ?? void 0,
    matchedTerms: matchingTerms(row.summary, parsedQuery.termVariants),
    sourceKind: "durable",
    timestamp: row.updated_at,
    ...candidateDateFields(row.updated_at)
  }));
}
function loadConversationCandidates({
  db,
  parsedQuery,
  timeRange,
  now,
  limit,
  projectRoot
}) {
  if (parsedQuery.termVariants.length > 0) {
    const params = [];
    const clauses = [];
    if (projectRoot) {
      const scope = buildProjectScopeClause("ce.project_root", projectRoot);
      clauses.push(scope.clause);
      params.push(...scope.params);
    }
    if (timeRange) {
      const resolved = resolveTimeRange(timeRange, now);
      clauses.push("ce.timestamp >= ?");
      params.push(resolved.from);
      clauses.push("ce.timestamp < ?");
      params.push(resolved.to);
    }
    const termClauses = parsedQuery.termVariants.map(
      () => "LOWER(COALESCE(ce.payload_json, ?)) LIKE ?"
    );
    const termParams = parsedQuery.termVariants.flatMap((term) => ["", `%${term.toLowerCase()}%`]);
    clauses.push(`(${termClauses.join(" OR ")})`);
    params.push(...termParams);
    const rows = db.all(
      `SELECT ce.event_id, ce.kind, ce.timestamp, ce.payload_json, ce.session_id, ce.project_root
       FROM conversation_events ce
       WHERE ${clauses.join(" AND ")}
       ORDER BY ce.timestamp DESC, ce.id DESC
       LIMIT ?`,
      [...params, limit]
    );
    return rows.map((row) => {
      const headline = summarizePayload(row.kind, row.payload_json);
      return {
        projectRoot: row.project_root ?? void 0,
        sessionId: row.session_id ?? void 0,
        headline,
        whyMatched: "recent conversation context",
        eventIds: [row.event_id],
        durableMemoryIds: [],
        intent: parsedQuery.intent,
        matchedTerms: matchingTerms(headline, parsedQuery.termVariants),
        sourceKind: "conversation",
        timestamp: row.timestamp,
        captureReason: row.kind,
        ...candidateDateFields(row.timestamp)
      };
    }).filter((candidate) => candidate.matchedTerms.length > 0);
  }
  const entries = handleTimeline(
    { db, projectRoot },
    {
      timeRange,
      summary: false,
      limit,
      now
    }
  );
  return entries.filter((entry) => typeof entry.summary === "string").map((entry) => ({
    projectRoot: entry.projectRoot ?? void 0,
    sessionId: entry.sessionId ?? void 0,
    headline: entry.summary ?? entry.kind,
    whyMatched: "recent conversation context",
    eventIds: [entry.eventId],
    durableMemoryIds: [],
    intent: parsedQuery.intent,
    matchedTerms: [],
    sourceKind: "conversation",
    timestamp: entry.timestamp,
    captureReason: entry.kind,
    ...candidateDateFields(entry.timestamp)
  }));
}
function loadSemanticCandidates({
  db,
  parsedQuery,
  timeRange,
  now,
  limit,
  projectRoot,
  includeLegacyGlobal,
  requireExactTermOverlap
}) {
  if (parsedQuery.termVariants.length === 0) {
    return [];
  }
  const params = [];
  const clauses = ["layer = 'semantic'"];
  if (projectRoot) {
    const scope = buildProjectScopeClause("project_root", projectRoot, {
      includeLegacyGlobal
    });
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  if (timeRange) {
    const resolved = resolveTimeRange(timeRange, now);
    clauses.push("updated_at >= ?");
    params.push(resolved.from);
    clauses.push("updated_at < ?");
    params.push(resolved.to);
  }
  const termClauses = parsedQuery.termVariants.map(() => "LOWER(content) LIKE ?");
  clauses.push(`(${termClauses.join(" OR ")})`);
  params.push(...parsedQuery.termVariants.map((term) => `%${term.toLowerCase()}%`));
  const rows = db.all(
    `SELECT id, content, updated_at, project_root
     FROM memories
     WHERE ${clauses.join(" AND ")}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );
  const candidates = rows.map((row) => ({
    projectRoot: row.project_root ?? void 0,
    headline: row.content,
    whyMatched: row.project_root ? `explicit semantic memory ${row.id}` : `legacy semantic memory ${row.id}`,
    eventIds: [],
    durableMemoryIds: [],
    intent: parsedQuery.intent,
    matchedTerms: matchingTerms(row.content, parsedQuery.termVariants),
    sourceKind: "semantic",
    timestamp: row.updated_at,
    ...candidateDateFields(row.updated_at)
  })).filter((candidate) => candidate.matchedTerms.length > 0);
  return requireExactTermOverlap ? candidates.filter((candidate) => hasExactTermOverlap(candidate.headline, parsedQuery.terms)) : candidates;
}
function loadRecallCandidates(options) {
  const strictDurableCandidates = loadDurableCandidates(options);
  const durableCandidates = options.projectRoot && strictDurableCandidates.length === 0 ? loadDurableCandidates({
    ...options,
    includeLegacyGlobal: true
  }) : strictDurableCandidates;
  const strictSemanticCandidates = loadSemanticCandidates(options);
  const semanticCandidates = options.projectRoot && strictSemanticCandidates.length === 0 ? loadSemanticCandidates({
    ...options,
    includeLegacyGlobal: true,
    requireExactTermOverlap: true
  }) : strictSemanticCandidates;
  const conversationCandidates = loadConversationCandidates(options);
  return [...durableCandidates, ...semanticCandidates, ...conversationCandidates];
}

// packages/core/src/recall/temporal-parser.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
var MONTH_LABELS_EN = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];
var MONTH_LABELS_RU = [
  "\u044F\u043D\u0432\u0430\u0440\u044C",
  "\u0444\u0435\u0432\u0440\u0430\u043B\u044C",
  "\u043C\u0430\u0440\u0442",
  "\u0430\u043F\u0440\u0435\u043B\u044C",
  "\u043C\u0430\u0439",
  "\u0438\u044E\u043D\u044C",
  "\u0438\u044E\u043B\u044C",
  "\u0430\u0432\u0433\u0443\u0441\u0442",
  "\u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044C",
  "\u043E\u043A\u0442\u044F\u0431\u0440\u044C",
  "\u043D\u043E\u044F\u0431\u0440\u044C",
  "\u0434\u0435\u043A\u0430\u0431\u0440\u044C"
];
var MONTH_NAMES = /* @__PURE__ */ new Map([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11],
  ["\u044F\u043D\u0432\u0430\u0440", 0],
  ["\u0444\u0435\u0432\u0440\u0430\u043B", 1],
  ["\u043C\u0430\u0440\u0442", 2],
  ["\u0430\u043F\u0440\u0435\u043B", 3],
  ["\u043C\u0430\u0439", 4],
  ["\u043C\u0430\u0435", 4],
  ["\u043C\u0430\u044F", 4],
  ["\u0438\u044E\u043D", 5],
  ["\u0438\u044E\u043B", 6],
  ["\u0430\u0432\u0433\u0443\u0441\u0442", 7],
  ["\u0441\u0435\u043D\u0442\u044F\u0431\u0440", 8],
  ["\u043E\u043A\u0442\u044F\u0431\u0440", 9],
  ["\u043D\u043E\u044F\u0431\u0440", 10],
  ["\u0434\u0435\u043A\u0430\u0431\u0440", 11]
]);
var WEEKDAY_TO_UTC_DAY = /* @__PURE__ */ new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
  ["\u0432\u043E\u0441\u043A\u0440\u0435\u0441\u0435\u043D\u044C\u0435", 0],
  ["\u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A", 1],
  ["\u0432\u0442\u043E\u0440\u043D\u0438\u043A", 2],
  ["\u0441\u0440\u0435\u0434\u0443", 3],
  ["\u0441\u0440\u0435\u0434\u0430", 3],
  ["\u0447\u0435\u0442\u0432\u0435\u0440\u0433", 4],
  ["\u043F\u044F\u0442\u043D\u0438\u0446\u0443", 5],
  ["\u043F\u044F\u0442\u043D\u0438\u0446\u0430", 5],
  ["\u0441\u0443\u0431\u0431\u043E\u0442\u0443", 6],
  ["\u0441\u0443\u0431\u0431\u043E\u0442\u0430", 6]
]);
function range(label, from, to, granularity) {
  return {
    label,
    from,
    to,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    ...granularity ? { granularity } : {}
  };
}
function normalizeQuestion(question) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}
function currentYear(now, mode) {
  const date = new Date(now);
  return mode === "utc" ? date.getUTCFullYear() : date.getFullYear();
}
function startOfMonthFor(year, month, mode) {
  if (mode === "utc") {
    return {
      from: Date.UTC(year, month, 1),
      to: Date.UTC(year, month + 1, 1)
    };
  }
  return {
    from: new Date(year, month, 1).getTime(),
    to: new Date(year, month + 1, 1).getTime()
  };
}
function hasMonthWord(question, monthWord) {
  const escaped = monthWord.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${escaped}\\p{L}*(?=$|[^\\p{L}])`, "u").test(question);
}
function parseMonthPhrase(question, now, mode) {
  if (/\bthis\s+month\b/u.test(question) || question.includes("\u0432 \u044D\u0442\u043E\u043C \u043C\u0435\u0441\u044F\u0446\u0435")) {
    const bucket = monthBucket(now, { mode });
    return range(
      question.includes("\u0432 \u044D\u0442\u043E\u043C \u043C\u0435\u0441\u044F\u0446\u0435") ? "\u0432 \u044D\u0442\u043E\u043C \u043C\u0435\u0441\u044F\u0446\u0435" : "this month",
      bucket.from,
      bucket.to,
      "month"
    );
  }
  const explicitYear = /\b(?<year>19\d{2}|20\d{2})\b/u.exec(question)?.groups?.year;
  const year = explicitYear ? Number(explicitYear) : currentYear(now, mode);
  for (const [monthWord, month] of MONTH_NAMES.entries()) {
    if (!hasMonthWord(question, monthWord)) {
      continue;
    }
    const { from, to } = startOfMonthFor(year, month, mode);
    const isEnglish = /^[a-z]/u.test(monthWord);
    const label = `${isEnglish ? MONTH_LABELS_EN[month] : MONTH_LABELS_RU[month]} ${year}`;
    return range(label, from, to, "month");
  }
  return void 0;
}
function parseDaysAgo(question, now, mode) {
  const match = /\b(?<days>\d{1,3})\s+days?\s+ago\b/u.exec(question) ?? /(?<days>\d{1,3})\s+дн(?:я|ей|ь)\s+назад/u.exec(question);
  if (!match?.groups?.days) {
    return void 0;
  }
  const days = Number(match.groups.days);
  if (!Number.isInteger(days) || days < 1) {
    return void 0;
  }
  const start = dayBucket(now, { mode }).from - days * DAY_MS;
  return range(match[0], start, start + DAY_MS, "day");
}
function parseWeekday(question, now, mode) {
  for (const [word, weekday] of WEEKDAY_TO_UTC_DAY.entries()) {
    if (!question.includes(word)) {
      continue;
    }
    const todayStart = dayBucket(now, { mode }).from;
    const today = new Date(todayStart);
    const currentDay = mode === "utc" ? today.getUTCDay() : today.getDay();
    const delta = (currentDay - weekday + 7) % 7 || 7;
    const start = todayStart - delta * DAY_MS;
    return range(question.includes(`\u0432 ${word}`) ? `\u0432 ${word}` : word, start, start + DAY_MS, "day");
  }
  return void 0;
}
function parseRecallTemporalRange(question, now, options) {
  const mode = options?.mode ?? "local";
  const normalized = normalizeQuestion(question);
  const todayStart = dayBucket(now, { mode }).from;
  if (/\btoday\b/u.test(normalized) || normalized.includes("\u0441\u0435\u0433\u043E\u0434\u043D\u044F")) {
    return range(
      normalized.includes("\u0441\u0435\u0433\u043E\u0434\u043D\u044F") ? "\u0441\u0435\u0433\u043E\u0434\u043D\u044F" : "today",
      todayStart,
      todayStart + DAY_MS,
      "day"
    );
  }
  if (/\byesterday\b/u.test(normalized) || normalized.includes("\u0432\u0447\u0435\u0440\u0430")) {
    return range(
      normalized.includes("\u0432\u0447\u0435\u0440\u0430") ? "\u0432\u0447\u0435\u0440\u0430" : "yesterday",
      todayStart - DAY_MS,
      todayStart,
      "day"
    );
  }
  if (normalized.includes("last week") || normalized.includes("\u043D\u0430 \u043F\u0440\u043E\u0448\u043B\u043E\u0439 \u043D\u0435\u0434\u0435\u043B\u0435")) {
    return range(
      normalized.includes("\u043D\u0430 \u043F\u0440\u043E\u0448\u043B\u043E\u0439 \u043D\u0435\u0434\u0435\u043B\u0435") ? "\u043D\u0430 \u043F\u0440\u043E\u0448\u043B\u043E\u0439 \u043D\u0435\u0434\u0435\u043B\u0435" : "last week",
      now - 7 * DAY_MS,
      now
    );
  }
  return parseMonthPhrase(normalized, now, mode) ?? parseDaysAgo(normalized, now, mode) ?? parseWeekday(normalized, now, mode);
}

// packages/core/src/recall/query-parser.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "about",
  "and",
  "did",
  "do",
  "decide",
  "decided",
  "during",
  "happened",
  "is",
  "just",
  "last",
  "me",
  "my",
  "the",
  "to",
  "we",
  "what",
  "which",
  "why",
  "yesterday",
  "\u0431\u044B\u043B\u0438",
  "\u0431\u044B\u043B\u043E",
  "\u0434\u0435\u043B\u0430\u043B\u0438",
  "\u043A\u0430\u043A\u0438\u0435",
  "\u043A\u0430\u043A\u043E\u0439",
  "\u043C\u0435\u043D\u044F",
  "\u043C\u044B",
  "\u043D\u0430",
  "\u043D\u0430\u0437\u0430\u0434",
  "\u043D\u0435\u0434\u0435\u043B\u0435",
  "\u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C",
  "\u043F\u043E\u0447\u0435\u043C\u0443",
  "\u043F\u0440\u0438",
  "\u043F\u0440\u043E",
  "\u043F\u0440\u043E\u0448\u043B\u043E\u0439",
  "\u0440\u0430\u0441\u0441\u043A\u0430\u0436\u0438",
  "\u0440\u0435\u0430\u043B\u044C\u043D\u043E",
  "\u0440\u0435\u0448\u0438\u043B\u0438",
  "\u0441\u0434\u0435\u043B\u0430\u0442\u044C",
  "\u0441\u0435\u0433\u043E\u0434\u043D\u044F",
  "\u0447\u0442\u043E",
  "\u0432\u0447\u0435\u0440\u0430"
]);
var INTENT_PATTERNS = [
  {
    intent: "rejected_alternative",
    patterns: [/\bwhy\b.*\breject(?:ed)?\b/u, /\bwhy\s+not\b/u, /почему\s+отказал/u]
  },
  {
    intent: "validation_fact",
    patterns: [/\b(?:passed|validation|verified|checked)\b/u, /проверен|проверено/u]
  },
  {
    intent: "next_step",
    patterns: [/\b(?:what\s+remains|next\s+steps?|todo)\b/u, /что\s+осталось|следующ/u]
  },
  {
    intent: "preference_style",
    patterns: [/\b(?:my\s+)?(?:code\s+)?style\b/u, /\bpreferences?\b/u, /стиль|предпочтен/u]
  },
  {
    intent: "bug_context",
    patterns: [
      /\b(?:errors?|failures?|bugs?|failed|failing|fix(?:ed|es)?)\b/u,
      /ошибк|падал|сломал|исправил/u
    ]
  },
  {
    intent: "decision",
    patterns: [/\bdecid(?:e|ed)\b/u, /что\s+решили|решили\s+по/u]
  },
  {
    intent: "work_summary",
    patterns: [/\bwhat\s+did\s+we\s+do\b/u, /что\s+(?:мы\s+)?делали/u]
  }
];
var TOPIC_HINTS = [
  { topic: "auth_strategy", patterns: [/\bauth\b/u, /\boauth\b/u, /авторизац/u] },
  { topic: "capture_strategy", patterns: [/\bcapture\s+strategy\b/u, /capture\s+mode/u] },
  { topic: "codex_hooks_strategy", patterns: [/\bhook-first\b/u, /\bcodex\s+hooks?\b/u] },
  { topic: "package_installation", patterns: [/\bnpm\s+install\b/u, /\binstall\b/u] },
  { topic: "user_workflow_style", patterns: [/\bwork\s+style\b/u, /стиль\s+работ/u] }
];
function normalizeQuestion2(question) {
  return question.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, " ").replace(/\s+/g, " ").trim();
}
function unique2(values) {
  return [...new Set(values)];
}
function stemLite2(term) {
  if (/^ошиб(?:ка|ки|ку|ке|кой|ок|ками)?$/u.test(term)) {
    return "\u043E\u0448\u0438\u0431\u043A";
  }
  return term;
}
function detectIntent(normalized) {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return intent;
    }
  }
  return "general";
}
function detectTopicHints(normalized) {
  return TOPIC_HINTS.filter(
    ({ patterns }) => patterns.some((pattern) => pattern.test(normalized))
  ).map(({ topic }) => topic);
}
function parseRecallQuery(question, now, options) {
  const normalized = normalizeQuestion2(question);
  const normalizedTerms = normalized.length > 0 ? normalized.split(" ") : [];
  const terms = normalizedTerms.filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
  const termVariants = unique2(terms.map(stemLite2));
  const temporalRange = parseRecallTemporalRange(question, now, {
    mode: options?.temporalMode ?? "local"
  });
  return {
    original: question,
    normalized,
    normalizedTerms,
    terms,
    termVariants,
    intent: detectIntent(normalized),
    ...temporalRange ? { temporalRange } : {},
    topicHints: detectTopicHints(normalized)
  };
}

// packages/core/src/recall/grouping.ts
var MAX_HEADING_LENGTH = 80;
function groupId(candidate, index) {
  const topicPart = candidate.topicKey ? `:topic:${candidate.topicKey}` : "";
  if (candidate.sessionId) {
    return `session:${candidate.sessionId}${topicPart}`;
  }
  const durableId = candidate.durableMemoryIds[0];
  if (durableId !== void 0) {
    return `durable:${durableId}${topicPart}`;
  }
  const eventId = candidate.eventIds[0];
  if (eventId !== void 0) {
    return `event:${eventId}${topicPart}`;
  }
  return `candidate:${index}${topicPart}`;
}
function clipHeading(headline) {
  if (headline.length <= MAX_HEADING_LENGTH) {
    return headline;
  }
  return `${headline.slice(0, MAX_HEADING_LENGTH - 3)}...`;
}
function mergeUnique(left, right) {
  return [.../* @__PURE__ */ new Set([...left, ...right])];
}
function maxConfidence(left, right) {
  const rank = { low: 0, medium: 1, high: 2 };
  if (!left) return right;
  if (!right) return left;
  return rank[right] > rank[left] ? right : left;
}
function groupRecallCandidates(candidates) {
  const groups = /* @__PURE__ */ new Map();
  candidates.forEach((candidate, index) => {
    const id = groupId(candidate, index);
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, {
        id,
        heading: clipHeading(candidate.headline),
        whyMatched: candidate.whyMatched,
        candidates: [candidate],
        eventIds: [...candidate.eventIds],
        durableMemoryIds: [...candidate.durableMemoryIds],
        ...candidate.sessionId ? { sessionId: candidate.sessionId } : {},
        ...candidate.topicKey ? { topicKey: candidate.topicKey } : {},
        ...candidate.confidence ? { confidence: candidate.confidence } : {}
      });
      return;
    }
    existing.candidates.push(candidate);
    existing.eventIds = mergeUnique(existing.eventIds, candidate.eventIds);
    existing.durableMemoryIds = mergeUnique(existing.durableMemoryIds, candidate.durableMemoryIds);
    existing.confidence = maxConfidence(existing.confidence, candidate.confidence);
  });
  return [...groups.values()];
}

// packages/core/src/recall/result-builder.ts
var DOMINANT_GROUP_SCORE_GAP = 3;
function topScore(candidate) {
  return candidate?.score ?? 0;
}
function isDominantTopGroup(candidates) {
  const topCandidate = candidates[0];
  if (!topCandidate) {
    return false;
  }
  const topGroupKey = groupKey(topCandidate);
  const nextDifferentGroup = candidates.find((candidate) => groupKey(candidate) !== topGroupKey);
  const scoreGap = topScore(topCandidate) - topScore(nextDifferentGroup);
  if (topCandidate.confidence === "high") {
    return scoreGap >= DOMINANT_GROUP_SCORE_GAP;
  }
  return topCandidate.sourceKind === "durable" && topCandidate.confidence === "medium" && scoreGap >= 3;
}
function groupKey(candidate) {
  if (candidate.topicKey) {
    return `topic:${candidate.topicKey}`;
  }
  if (candidate.sessionId) {
    return `session:${candidate.sessionId}`;
  }
  if (candidate.durableMemoryIds[0] !== void 0) {
    return `durable:${candidate.durableMemoryIds[0]}`;
  }
  return `event:${candidate.eventIds[0] ?? "unknown"}`;
}
function buildRecallResult({
  question,
  candidates,
  resolvedRange,
  searchedDateBuckets,
  matchedIntent,
  matchedTopics
}) {
  const candidateGroups = groupRecallCandidates(candidates);
  const resultMetadata = {
    ...matchedIntent ? { matchedIntent } : {},
    ...matchedTopics && matchedTopics.length > 0 ? { matchedTopics } : {},
    ...searchedDateBuckets ? { searchedDateBuckets } : {}
  };
  if (candidateGroups.length === 0) {
    return {
      status: "no_memory",
      question,
      ...resolvedRange ? { resolvedRange } : {},
      ...resultMetadata,
      summary: "No matching memory found.",
      candidates: [],
      candidateGroups: []
    };
  }
  if (candidateGroups.length === 1) {
    const group = candidateGroups[0];
    if (!group) {
      throw new Error("Expected a recall candidate group.");
    }
    return {
      status: "ok",
      question,
      ...resolvedRange ? { resolvedRange } : {},
      ...resultMetadata,
      summary: group.candidates[0]?.headline ?? group.heading,
      candidates,
      candidateGroups,
      confidence: group.confidence
    };
  }
  const topCandidate = candidates[0];
  if (topCandidate && isDominantTopGroup(candidates)) {
    return {
      status: "ok",
      question,
      ...resolvedRange ? { resolvedRange } : {},
      ...resultMetadata,
      summary: topCandidate.headline,
      candidates,
      candidateGroups,
      confidence: topCandidate.confidence
    };
  }
  return {
    status: "needs_clarification",
    question,
    ...resolvedRange ? { resolvedRange } : {},
    ...resultMetadata,
    summary: "I found multiple possible matches. Please clarify which one you mean.",
    candidates,
    candidateGroups
  };
}

// packages/core/src/recall/scoring.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;
var DURABLE_PRIORITY_INTENTS = /* @__PURE__ */ new Set([
  "decision",
  "preference_style",
  "rejected_alternative",
  "next_step",
  "validation_fact"
]);
var COMPLETION_EVENT_INTENTS = /* @__PURE__ */ new Set(["bug_context", "validation_fact", "work_summary"]);
var COMPLETION_CAPTURE_REASONS = /* @__PURE__ */ new Set(["session_end", "task_complete"]);
var VALIDATION_COMMAND_PATTERN = /\b(?:npm\s+(?:test|-w)|typecheck|vitest|pytest|cargo\s+test)\b/i;
function confidenceForScore(score) {
  if (score >= 12) {
    return "high";
  }
  if (score >= 6) {
    return "medium";
  }
  return "low";
}
function recencyScore(timestamp4, now) {
  const ageDays = Math.max(0, (now - timestamp4) / DAY_MS2);
  if (ageDays <= 1) {
    return 3;
  }
  if (ageDays <= 7) {
    return 2;
  }
  if (ageDays <= 30) {
    return 1;
  }
  return 0;
}
function exactEntityTokens(values) {
  return values.filter(
    (value) => /^(?:v?\d+\.\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]{2,}|memory_[a-z_]+|[@\w.-]+\/[\w.-]+|[\w./-]+\.(?:ts|tsx|js|mjs|md|json))$/u.test(
      value
    )
  );
}
function hasExactEntityMatch(candidate, parsedQuery) {
  const rawTokens = parsedQuery.original.split(/\s+/u).map((token) => token.replace(/^[,;:!?()[\]{}"']+|[,;:!?()[\]{}"']+$/gu, "")).filter(Boolean);
  const entities = exactEntityTokens([
    ...rawTokens,
    ...parsedQuery.terms,
    ...parsedQuery.normalizedTerms
  ]);
  if (entities.length === 0) {
    return false;
  }
  const haystack = [
    candidate.headline,
    ...candidate.matchedTerms ?? [],
    candidate.topicKey ?? "",
    candidate.captureReason ?? ""
  ].join(" ").toLowerCase();
  return entities.some((entity) => haystack.includes(entity.toLowerCase()));
}
function filterProjectCandidates(candidates, projectRoot) {
  if (!projectRoot) {
    return candidates;
  }
  return candidates.filter(
    (candidate) => !candidate.projectRoot || isSameProjectRoot(candidate.projectRoot, projectRoot)
  );
}
function scoreRecallCandidate(candidate, parsedQuery, options) {
  let score = 0;
  const reasons = [];
  if (options.projectRoot && candidate.projectRoot && isSameProjectRoot(candidate.projectRoot, options.projectRoot)) {
    score += 10;
    reasons.push("project_match");
  }
  if (candidate.intent === parsedQuery.intent) {
    score += 3;
    reasons.push("intent_match");
  }
  if (candidate.topicKey && parsedQuery.topicHints.includes(candidate.topicKey)) {
    score += 4;
    reasons.push("topic_match");
  }
  if (candidate.matchedTerms && candidate.matchedTerms.length > 0) {
    score += Math.min(candidate.matchedTerms.length, 4);
    reasons.push("term_overlap");
  }
  if (typeof candidate.timestamp === "number") {
    if (options.resolvedRange && candidate.timestamp >= options.resolvedRange.from && candidate.timestamp < options.resolvedRange.to) {
      score += 5;
      reasons.push("time_range_fit");
    }
    const bonus = recencyScore(candidate.timestamp, options.now);
    if (bonus > 0) {
      score += bonus;
      reasons.push("recent");
    }
  }
  if (candidate.sourceKind === "durable" && DURABLE_PRIORITY_INTENTS.has(parsedQuery.intent)) {
    score += 3;
    reasons.push("durable_priority");
  }
  if (candidate.sourceKind === "semantic") {
    score += 2;
    reasons.push("explicit_memory");
  }
  if (candidate.captureReason === parsedQuery.intent) {
    score += 2;
    reasons.push("capture_reason_match");
  }
  if (candidate.captureReason && COMPLETION_CAPTURE_REASONS.has(candidate.captureReason) && COMPLETION_EVENT_INTENTS.has(parsedQuery.intent)) {
    score += 5;
    reasons.push("completion_event");
  }
  if (parsedQuery.intent === "validation_fact" && VALIDATION_COMMAND_PATTERN.test(candidate.headline)) {
    score += 3;
    reasons.push("validation_command_context");
  }
  if (hasExactEntityMatch(candidate, parsedQuery)) {
    score += 4;
    reasons.push("exact_entity_match");
  }
  if (candidate.eventIds.length > 0 || candidate.durableMemoryIds.length > 0 || candidate.sourceKind === "semantic") {
    score += 1;
    reasons.push("evidence_present");
  }
  if (options.projectRoot && !candidate.projectRoot) {
    score -= 4;
    reasons.push("legacy_global");
  }
  const confidence = confidenceForScore(score);
  return {
    candidate: {
      ...candidate,
      score,
      confidence
    },
    score,
    confidence,
    reasons
  };
}
function scoreRecallCandidates(candidates, parsedQuery, options) {
  return candidates.map((candidate) => scoreRecallCandidate(candidate, parsedQuery, options).candidate).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// packages/core/src/recall/engine.ts
function resolveRangeLabel(timeRange) {
  if (timeRange.relative) {
    return timeRange.relative;
  }
  return "custom";
}
function resolveRangeGranularity(timeRange) {
  switch (timeRange.relative) {
    case "today":
    case "yesterday":
      return "day";
    case "this_week":
      return "week";
    case "this_month":
    case "last_month":
      return "month";
    case "last_7d":
    case "last_30d":
      return "custom";
    default:
      return timeRange.relative ? void 0 : "custom";
  }
}
function buildResolvedRange(label, timeRange, now, temporalMode) {
  const resolved = resolveTimeRange(timeRange, now, temporalMode);
  const granularity = resolveRangeGranularity(timeRange);
  return {
    timeRange,
    resolvedRange: {
      label,
      from: resolved.from,
      to: resolved.to,
      fromIso: new Date(resolved.from).toISOString(),
      toIso: new Date(resolved.to).toISOString(),
      ...granularity ? { granularity } : {}
    }
  };
}
function buildBucketsForCandidates(candidates, resolvedRange) {
  const buckets = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    if (candidate.timestamp === void 0) {
      continue;
    }
    if (candidate.timestamp < resolvedRange.from || candidate.timestamp >= resolvedRange.to) {
      continue;
    }
    const day = dayBucket(candidate.timestamp, { mode: "local" });
    const key = candidate.localDate ?? day.key;
    const bucket = buckets.get(key) ?? {
      key,
      label: key,
      from: day.from,
      to: day.to,
      eventCount: 0,
      durableCount: 0,
      sessionIds: /* @__PURE__ */ new Set(),
      topicKeys: /* @__PURE__ */ new Set()
    };
    bucket.eventCount += candidate.eventIds.length;
    bucket.durableCount += candidate.durableMemoryIds.length;
    if (candidate.sessionId) {
      bucket.sessionIds.add(candidate.sessionId);
    }
    if (candidate.topicKey) {
      bucket.topicKeys.add(candidate.topicKey);
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.from - right.from).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    from: bucket.from,
    to: bucket.to,
    eventCount: bucket.eventCount,
    sessionCount: bucket.sessionIds.size,
    durableCount: bucket.durableCount,
    topicKeys: [...bucket.topicKeys].sort()
  }));
}
function runRecallEngine(question, deps, options) {
  const now = options?.now ?? deps.now ?? Date.now();
  const limit = Math.max(1, options?.limit ?? 10);
  const temporalMode = options?.temporalMode ?? "local";
  const parsedQuery = parseRecallQuery(question, now, { temporalMode });
  const explicitRange = options?.timeRange ? buildResolvedRange(resolveRangeLabel(options.timeRange), options.timeRange, now, temporalMode) : void 0;
  const timeRange = explicitRange?.timeRange ?? (parsedQuery.temporalRange ? { from: parsedQuery.temporalRange.from, to: parsedQuery.temporalRange.to } : void 0);
  const resolvedRange = explicitRange?.resolvedRange ?? parsedQuery.temporalRange;
  const loadedCandidates = loadRecallCandidates({
    db: deps.db,
    parsedQuery,
    timeRange,
    now,
    limit,
    projectRoot: deps.projectRoot
  });
  const candidates = filterProjectCandidates(loadedCandidates, deps.projectRoot);
  const scoredCandidates = scoreRecallCandidates(candidates, parsedQuery, {
    now,
    projectRoot: deps.projectRoot,
    resolvedRange: resolvedRange ? { from: resolvedRange.from, to: resolvedRange.to } : void 0
  }).slice(0, limit);
  const searchedDateBuckets = resolvedRange ? buildBucketsForCandidates(scoredCandidates, resolvedRange) : void 0;
  return buildRecallResult({
    question,
    candidates: scoredCandidates,
    resolvedRange,
    searchedDateBuckets,
    matchedIntent: parsedQuery.intent,
    matchedTopics: parsedQuery.topicHints
  });
}

// packages/core/src/tools/project-state.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join as join2 } from "node:path";
var GIT_STATE_CACHE_MS = 5e3;
var gitStateCache;
function gitOutput(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 750
  }).trim();
}
function readGitState(cwd) {
  const now = Date.now();
  if (gitStateCache && gitStateCache.cwd === cwd && now - gitStateCache.checkedAt < GIT_STATE_CACHE_MS) {
    return gitStateCache.state;
  }
  try {
    const state = {
      gitHead: gitOutput(cwd, ["rev-parse", "--short", "HEAD"]),
      gitBranch: gitOutput(cwd, ["branch", "--show-current"]),
      dirty: gitOutput(cwd, ["status", "--porcelain", "--untracked-files=no"]).length > 0
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  } catch (error) {
    const state = {
      timedOut: error instanceof Error && /timeout/i.test(error.message),
      unavailable: true
    };
    gitStateCache = { cwd, checkedAt: now, state };
    return state;
  }
}
function readPackageMetadata(projectRoot) {
  const packagePath = join2(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    return {
      name: typeof parsed.name === "string" ? parsed.name : void 0,
      version: typeof parsed.version === "string" ? parsed.version : void 0
    };
  } catch {
    return {};
  }
}
function handleProjectState(deps) {
  const projectRoot = normalizeProjectRootForScope(deps.projectRoot);
  const packageMetadata = readPackageMetadata(deps.projectRoot);
  const activeDurableCount = deps.db.get(
    "SELECT COUNT(*) AS cnt FROM durable_memories WHERE state = ? AND project_root = ?",
    ["active", projectRoot]
  )?.cnt ?? 0;
  const latest = deps.db.get(
    `SELECT timestamp
     FROM conversation_events
     WHERE project_root = ?
     ORDER BY timestamp DESC, id DESC
     LIMIT 1`,
    [projectRoot]
  );
  const nextSteps = deps.db.all(
    `SELECT summary
       FROM durable_memories
       WHERE memory_type = ? AND state = ? AND project_root = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT 5`,
    ["next_step", "active", projectRoot]
  ).map((row) => row.summary);
  const git = (deps.readGitState ?? readGitState)(deps.projectRoot);
  const warnings = [
    ...latest ? [] : ["No conversation events found for this project."],
    ...git.timedOut ? ["Git state lookup timed out; repo state may be incomplete."] : [],
    ...!git.timedOut && git.unavailable ? ["Git state lookup failed; repo state may be incomplete."] : []
  ];
  return {
    projectRoot,
    projectHash: projectHash(projectRoot),
    packageName: packageMetadata.name,
    packageVersion: packageMetadata.version,
    gitHead: git.gitHead,
    gitBranch: git.gitBranch,
    dirty: git.dirty,
    activeDurableCount,
    latestConversationTimestamp: latest?.timestamp,
    latestConversationIso: latest ? new Date(latest.timestamp).toISOString() : void 0,
    warnings,
    nextSteps
  };
}

// packages/core/src/context/auto-brief.ts
var MAX_BULLET_CHARS = 140;
var NOISY_PHRASES = /* @__PURE__ */ new Set([
  "ok",
  "okay",
  "yes",
  "no",
  "yep",
  "yup",
  "nope",
  "sure",
  "continue",
  "go",
  "go ahead",
  "proceed",
  "thanks",
  "thank you",
  "thx",
  "done",
  "lgtm",
  "sounds good",
  "got it",
  "agreed",
  "\u0434\u0430",
  "\u043D\u0435\u0442",
  "\u043E\u043A",
  "\u043E\u043A\u0435\u0439",
  "\u0445\u043E\u0440\u043E\u0448\u043E",
  "\u043B\u0430\u0434\u043D\u043E",
  "\u043F\u043E\u043D\u044F\u043B",
  "\u043F\u043E\u043D\u044F\u0442\u043D\u043E",
  "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439",
  "\u0434\u0430\u043B\u044C\u0448\u0435",
  "\u0434\u0435\u043B\u0430\u0439",
  "\u043F\u043E\u0435\u0445\u0430\u043B\u0438",
  "\u0441\u043F\u0430\u0441\u0438\u0431\u043E",
  "\u0433\u043E\u0442\u043E\u0432\u043E",
  "\u043D\u043E\u0440\u043C",
  "\u0430\u0433\u0430",
  "\u0443\u0433\u0443",
  "\u0441\u0443\u043F\u0435\u0440",
  "\u043E\u0442\u043B\u0438\u0447\u043D\u043E"
]);
var SINGLE_ACK_WORDS = /* @__PURE__ */ new Set([
  "ok",
  "okay",
  "yes",
  "no",
  "yep",
  "yup",
  "nope",
  "sure",
  "continue",
  "go",
  "proceed",
  "thanks",
  "thx",
  "done",
  "lgtm",
  "agreed",
  "\u0434\u0430",
  "\u043D\u0435\u0442",
  "\u043E\u043A",
  "\u043E\u043A\u0435\u0439",
  "\u0445\u043E\u0440\u043E\u0448\u043E",
  "\u043B\u0430\u0434\u043D\u043E",
  "\u043F\u043E\u043D\u044F\u043B",
  "\u043F\u043E\u043D\u044F\u0442\u043D\u043E",
  "\u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0439",
  "\u0434\u0430\u043B\u044C\u0448\u0435",
  "\u0434\u0435\u043B\u0430\u0439",
  "\u043F\u043E\u0435\u0445\u0430\u043B\u0438",
  "\u0441\u043F\u0430\u0441\u0438\u0431\u043E",
  "\u0433\u043E\u0442\u043E\u0432\u043E",
  "\u043D\u043E\u0440\u043C",
  "\u0430\u0433\u0430",
  "\u0443\u0433\u0443",
  "\u0441\u0443\u043F\u0435\u0440",
  "\u043E\u0442\u043B\u0438\u0447\u043D\u043E"
]);
function emptyBrief(mode, reason) {
  return {
    mode,
    injected: false,
    reason,
    text: "",
    estimatedTokens: 0,
    includedDurableIds: [],
    includedEventIds: []
  };
}
function truncateLine(text, maxChars = MAX_BULLET_CHARS) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3)}...`;
}
function isNumberedAcknowledgement(text) {
  const withoutNumbers = text.toLowerCase().replace(/\b\d+[.)]\s*/gu, " ").replace(/[.!?…,;:]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!withoutNumbers) {
    return false;
  }
  const tokens = withoutNumbers.split(" ");
  return tokens.length <= 6 && tokens.every((token) => SINGLE_ACK_WORDS.has(token));
}
function isNoisyPrompt(prompt) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }
  if (/^\/[a-z0-9_:-]+$/iu.test(normalized)) {
    return true;
  }
  const stripped = normalized.toLowerCase().replace(/[.!?…,;:]+$/gu, "").trim();
  if (!stripped) {
    return true;
  }
  if (NOISY_PHRASES.has(stripped)) {
    return true;
  }
  if (/^\d+[.)]\s*/u.test(normalized) && isNumberedAcknowledgement(normalized)) {
    return true;
  }
  if (normalized.length < 8 && !/[./?]/u.test(normalized)) {
    return true;
  }
  return false;
}
function appendLineWithinBudget(lines, line, maxTokens) {
  const candidate = lines.length === 0 ? line : `${lines.join("\n")}
${line}`;
  if (estimateTokens(candidate) > maxTokens) {
    return false;
  }
  lines.push(line);
  return true;
}
function appendSectionItems(lines, header, items, maxTokens, getText, onIncluded) {
  const firstItem = items[0];
  if (!firstItem) {
    return;
  }
  const firstBullet = `- ${truncateLine(getText(firstItem))}`;
  const preview = `${lines.join("\n")}
${header}
${firstBullet}`;
  if (estimateTokens(preview) > maxTokens) {
    return;
  }
  lines.push(header, firstBullet);
  onIncluded?.(firstItem);
  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    if (!appendLineWithinBudget(lines, `- ${truncateLine(getText(item))}`, maxTokens)) {
      break;
    }
    onIncluded?.(item);
  }
}
function buildSessionStartBrief(deps, options) {
  const maxTokens = Math.max(40, options?.maxTokens ?? 500);
  const maxDecisions = Math.max(1, options?.maxDecisions ?? 5);
  const maxConstraints = Math.max(1, options?.maxConstraints ?? 3);
  const maxNextSteps = Math.max(1, options?.maxNextSteps ?? 3);
  const maxRecentFiles = Math.max(1, options?.maxRecentFiles ?? 5);
  const scopedRoot = normalizeProjectRootForScope(deps.projectRoot);
  const scope = buildProjectScopeClause("project_root", scopedRoot);
  const state = handleProjectState({
    db: deps.db,
    projectRoot: deps.projectRoot,
    readGitState: deps.readGitState
  });
  const decisions = deps.db.all(
    `SELECT id, summary
     FROM durable_memories
     WHERE memory_type = 'decision' AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxDecisions]
  );
  const semanticFallback = decisions.length === 0 ? deps.db.all(
    `SELECT content
           FROM memories
           WHERE layer = 'semantic' AND ${scope.clause}
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`,
    [...scope.params, maxDecisions]
  ) : [];
  const constraintsAndPrefs = deps.db.all(
    `SELECT id, summary
     FROM durable_memories
     WHERE memory_type IN ('constraint', 'preference', 'style') AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxConstraints]
  );
  const nextSteps = deps.db.all(
    `SELECT id, summary
     FROM durable_memories
     WHERE memory_type = 'next_step' AND state = 'active' AND ${scope.clause}
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [...scope.params, maxNextSteps]
  );
  const eventScope = buildProjectScopeClause("ce.project_root", scopedRoot);
  const recentFiles = deps.db.all(
    `SELECT ef.file_path
       FROM event_files ef
       JOIN conversation_events ce ON ce.event_id = ef.event_id
       WHERE ${eventScope.clause}
       GROUP BY ef.file_path
       ORDER BY MAX(ce.timestamp) DESC
       LIMIT ?`,
    [...eventScope.params, maxRecentFiles]
  ).map((row) => row.file_path);
  const hasContent = decisions.length > 0 || semanticFallback.length > 0 || constraintsAndPrefs.length > 0 || nextSteps.length > 0 || state.latestConversationTimestamp !== void 0;
  if (!hasContent) {
    return emptyBrief("session_start", "empty_memory");
  }
  const lines = [];
  if (!appendLineWithinBudget(lines, "[Locus Memory \u2014 Project Brief]", maxTokens)) {
    return emptyBrief("session_start", "empty_memory");
  }
  const projectParts = [state.packageName || basename(scopedRoot) || scopedRoot];
  if (state.packageVersion) {
    projectParts.push(`v${state.packageVersion}`);
  }
  if (state.gitBranch) {
    projectParts.push(`branch=${state.gitBranch}`);
  }
  if (state.dirty) {
    projectParts.push("dirty");
  }
  appendLineWithinBudget(lines, `Project: ${projectParts.join(" | ")}`, maxTokens);
  const includedDurableIds = [];
  if (decisions.length > 0) {
    appendSectionItems(
      lines,
      "Decisions:",
      decisions,
      maxTokens,
      (item) => item.summary,
      (item) => includedDurableIds.push(item.id)
    );
  } else if (semanticFallback.length > 0) {
    appendSectionItems(lines, "Decisions:", semanticFallback, maxTokens, (item) => item.content);
  }
  if (constraintsAndPrefs.length > 0) {
    appendSectionItems(
      lines,
      "Constraints & Preferences:",
      constraintsAndPrefs,
      maxTokens,
      (item) => item.summary,
      (item) => includedDurableIds.push(item.id)
    );
  }
  if (nextSteps.length > 0) {
    appendSectionItems(
      lines,
      "Next Steps:",
      nextSteps,
      maxTokens,
      (item) => item.summary,
      (item) => includedDurableIds.push(item.id)
    );
  }
  if (recentFiles.length > 0) {
    appendLineWithinBudget(lines, `Recent Files: ${recentFiles.join(", ")}`, maxTokens);
  }
  const text = lines.join("\n");
  return {
    mode: "session_start",
    injected: true,
    reason: "ok",
    text,
    estimatedTokens: estimateTokens(text),
    includedDurableIds,
    includedEventIds: []
  };
}
function meetsConfidence(confidence, minConfidence) {
  if (minConfidence === "high") {
    return confidence === "high";
  }
  return confidence === "high" || confidence === "medium";
}
function isRelevantCandidate(candidate, hasResolvedRange) {
  return (candidate.matchedTerms?.length ?? 0) > 0 || Boolean(candidate.topicKey) || hasResolvedRange || candidate.sourceKind === "durable" && candidate.confidence === "high";
}
function isAlreadyInjected(candidate, seenDurable, seenEvents) {
  if (candidate.durableMemoryIds.length > 0) {
    return candidate.durableMemoryIds.every((id) => seenDurable.has(id));
  }
  if (candidate.eventIds.length > 0) {
    return candidate.eventIds.every((id) => seenEvents.has(id));
  }
  return false;
}
function buildPromptRecallBrief(prompt, deps, options) {
  if (isNoisyPrompt(prompt)) {
    return emptyBrief("prompt_recall", "noise_filtered");
  }
  const maxTokens = Math.max(40, options?.maxTokens ?? 300);
  const maxItems = Math.max(1, options?.maxItems ?? 3);
  const minConfidence = options?.minConfidence ?? "medium";
  const now = deps.now ?? Date.now();
  const recall = runRecallEngine(
    prompt,
    { db: deps.db, projectRoot: deps.projectRoot, now },
    { limit: 8, now }
  );
  if (recall.status === "no_memory" || recall.candidates.length === 0) {
    return emptyBrief("prompt_recall", "empty_memory");
  }
  const hasResolvedRange = Boolean(recall.resolvedRange);
  const confidentAndRelevant = recall.candidates.filter(
    (candidate) => meetsConfidence(candidate.confidence, minConfidence) && isRelevantCandidate(candidate, hasResolvedRange)
  );
  if (confidentAndRelevant.length === 0) {
    return emptyBrief("prompt_recall", "low_confidence");
  }
  const seenDurable = new Set(options?.alreadyInjectedDurableIds ?? []);
  const seenEvents = new Set(options?.alreadyInjectedEventIds ?? []);
  const freshCandidates = confidentAndRelevant.filter(
    (candidate) => !isAlreadyInjected(candidate, seenDurable, seenEvents)
  );
  if (freshCandidates.length === 0) {
    return emptyBrief("prompt_recall", "already_injected");
  }
  const lines = ["[Locus Memory \u2014 Relevant Recall]"];
  const includedDurableIds = /* @__PURE__ */ new Set();
  const includedEventIds = /* @__PURE__ */ new Set();
  let added = 0;
  for (const candidate of freshCandidates) {
    if (added >= maxItems) {
      break;
    }
    const label = candidate.topicKey ?? candidate.intent ?? candidate.sourceKind ?? "memory";
    const bullet = `- [${label}] ${truncateLine(candidate.headline)}`;
    if (!appendLineWithinBudget(lines, bullet, maxTokens)) {
      break;
    }
    added++;
    for (const id of candidate.durableMemoryIds) {
      includedDurableIds.add(id);
    }
    for (const id of candidate.eventIds) {
      includedEventIds.add(id);
    }
  }
  if (added === 0) {
    return emptyBrief("prompt_recall", "empty_memory");
  }
  const text = lines.join("\n");
  return {
    mode: "prompt_recall",
    injected: true,
    reason: "ok",
    text,
    estimatedTokens: estimateTokens(text),
    includedDurableIds: [...includedDurableIds],
    includedEventIds: [...includedEventIds]
  };
}

// packages/core/src/ingest/pipeline.ts
import { readdirSync, readFileSync as readFileSync2, unlinkSync } from "node:fs";
import { join as join3 } from "node:path";

// packages/core/src/security/file-ignore.ts
var DENYLIST_FILES = [
  // Environment and config files
  ".env",
  ".env.*",
  ".npmrc",
  ".pypirc",
  ".netrc",
  // Crypto key files
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  // SSH keys
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  // Credential files
  "credentials.*",
  "secrets.*",
  "service-account*.json",
  // Cloud provider credentials
  ".docker/config.json",
  ".aws/credentials",
  ".azure/accessTokens.json",
  // Secret directories
  "**/secrets/**",
  "**/.secrets/**"
];
function matchGlob(name, pattern) {
  const regexStr = pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
  return new RegExp(`^${regexStr}$`).test(name);
}
function isDenylisted(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const basename4 = normalized.split("/").pop() ?? normalized;
  for (const pattern of DENYLIST_FILES) {
    if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
      const dir = pattern.slice(3, -3);
      if (normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)) {
        return true;
      }
      continue;
    }
    if (pattern.includes("/")) {
      if (normalized === pattern || normalized.endsWith(`/${pattern}`)) {
        return true;
      }
      continue;
    }
    if (matchGlob(basename4, pattern)) {
      return true;
    }
  }
  return false;
}

// packages/core/src/security/redact.ts
var REDACT_PATTERNS = [
  // Private key blocks (multiline — must run first)
  {
    pattern: /-----BEGIN [\w\s]*PRIVATE KEY-----[\s\S]*?-----END [\w\s]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  // Known-prefix API keys
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})/g, replacement: "sk-[REDACTED]" },
  { pattern: /\b(pk-[a-zA-Z0-9]{20,})/g, replacement: "pk-[REDACTED]" },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})/g, replacement: "ghp_[REDACTED]" },
  { pattern: /\b(gho_[a-zA-Z0-9]{36,})/g, replacement: "gho_[REDACTED]" },
  {
    pattern: /\b(glpat-[a-zA-Z0-9\-_]{20,})/g,
    replacement: "glpat-[REDACTED]"
  },
  { pattern: /\b(xox[bpas]-[a-zA-Z0-9-]+)/g, replacement: "xox_-[REDACTED]" },
  // AWS access keys (AKIA + 16 uppercase alphanumeric)
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, replacement: "AKIA[REDACTED]" },
  // Connection strings (protocol://...)
  {
    pattern: /((?:postgres|mysql|mongodb|redis|amqp):\/\/)[^\s'"]+/gi,
    replacement: "$1[REDACTED]"
  },
  // Bearer tokens (20+ chars after "Bearer ")
  {
    pattern: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi,
    replacement: "$1[REDACTED]"
  },
  // Generic KEY=VALUE (requires 8+ char value to avoid false positives)
  {
    pattern: /\b([A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*)\s*[=:]\s*(['"]?)([^'",}\\\s]{8,})\2/gi,
    replacement: "$1=$2[REDACTED]$2"
  }
];
function redact(text) {
  let result = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// packages/core/src/ingest/dedup.ts
function isDuplicate(db, eventId) {
  const row = db.get("SELECT id FROM ingest_log WHERE event_id = ?", [eventId]);
  return row !== void 0;
}
function recordProcessed(db, event) {
  db.run(
    "INSERT OR IGNORE INTO ingest_log (event_id, source, source_event_id, processed_at) VALUES (?, ?, ?, ?)",
    [event.event_id, event.source, event.source_event_id ?? null, Date.now()]
  );
}

// packages/core/src/ingest/filters.ts
function captureLevelGate(event, captureLevel) {
  if (captureLevel === "metadata") {
    return event.kind !== "user_prompt" && event.kind !== "ai_response";
  }
  if (captureLevel === "redacted") {
    return event.kind !== "ai_response" || event.payload.capture_policy === "bounded_redacted";
  }
  return true;
}
var PROMPT_LOW_THRESHOLD = 5;
var PROMPT_HIGH_THRESHOLD = 50;
var HIGH_SIG_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "NotebookEdit"]);
function classifySignificance(event) {
  const payload = event.payload;
  switch (event.kind) {
    case "user_prompt": {
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
      const wordCount = prompt.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < PROMPT_LOW_THRESHOLD) return "low";
      if (wordCount > PROMPT_HIGH_THRESHOLD) return "high";
      return "medium";
    }
    case "tool_use": {
      const tool = typeof payload.tool === "string" ? payload.tool : "";
      const status = typeof payload.status === "string" ? payload.status : "";
      if (status === "error") return "high";
      if (HIGH_SIG_TOOLS.has(tool)) return "high";
      return "medium";
    }
    case "file_diff":
      return "medium";
    case "ai_response":
      return "medium";
    case "session_start":
    case "session_end":
      return "low";
    default:
      return "medium";
  }
}
var DEDUP_WINDOW_MS = 5 * 60 * 1e3;
function shouldDedup(event, db) {
  if (event.kind === "user_prompt") {
    return dedupPrompt(event, db);
  }
  if (event.kind === "file_diff") {
    return dedupFileDiff(event, db);
  }
  return false;
}
function dedupPrompt(event, db) {
  const prompt = typeof event.payload.prompt === "string" ? event.payload.prompt : "";
  if (!prompt) return false;
  const windowStart = event.timestamp - DEDUP_WINDOW_MS;
  const row = db.get(
    `SELECT id FROM conversation_events
     WHERE kind = 'user_prompt'
       AND timestamp >= ?
       AND payload_json LIKE ? ESCAPE '\\'
     LIMIT 1`,
    [windowStart, `%${escapeForLike(prompt)}%`]
  );
  return row !== void 0;
}
function dedupFileDiff(event, db) {
  const path = typeof event.payload.path === "string" ? event.payload.path : "";
  if (!path) return false;
  const windowStart = event.timestamp - DEDUP_WINDOW_MS;
  const row = db.get(
    `SELECT id FROM conversation_events
     WHERE kind = 'file_diff'
       AND timestamp >= ?
       AND payload_json LIKE ? ESCAPE '\\'
     LIMIT 1`,
    [windowStart, `%${escapeForLike(path)}%`]
  );
  return row !== void 0;
}
function escapeForLike(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// packages/core/src/ingest/schema.ts
var VALID_EVENT_KINDS = /* @__PURE__ */ new Set([
  "user_prompt",
  "ai_response",
  "tool_use",
  "file_diff",
  "session_start",
  "session_end"
]);
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length >= 1;
}
function isValidEventKind(value) {
  return typeof value === "string" && VALID_EVENT_KINDS.has(value);
}
function validateInboxEvent(json) {
  if (!isPlainRecord(json)) {
    return null;
  }
  if (json.version !== 1) {
    return null;
  }
  if (!isNonEmptyString(json.event_id) || !isNonEmptyString(json.source) || !isNonEmptyString(json.project_root)) {
    return null;
  }
  if (json.source_event_id !== void 0 && typeof json.source_event_id !== "string") {
    return null;
  }
  if (json.session_id !== void 0 && typeof json.session_id !== "string") {
    return null;
  }
  if (typeof json.timestamp !== "number" || !Number.isSafeInteger(json.timestamp) || json.timestamp <= 0) {
    return null;
  }
  if (!isValidEventKind(json.kind) || !isPlainRecord(json.payload)) {
    return null;
  }
  const event = {
    version: 1,
    event_id: json.event_id,
    source: json.source,
    project_root: json.project_root,
    timestamp: json.timestamp,
    kind: json.kind,
    payload: json.payload
  };
  if (json.source_event_id !== void 0) {
    event.source_event_id = json.source_event_id;
  }
  if (json.session_id !== void 0) {
    event.session_id = json.session_id;
  }
  return event;
}

// packages/core/src/ingest/pipeline.ts
function processInbox(inboxDir, db, options) {
  const start = Date.now();
  const captureLevel = options?.captureLevel ?? "metadata";
  const fts5 = options?.fts5Available ?? false;
  const metrics = {
    processed: 0,
    skipped: 0,
    duplicates: 0,
    filtered: 0,
    errors: 0,
    durationMs: 0,
    remaining: 0
  };
  let files;
  try {
    files = readdirSync(inboxDir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    metrics.durationMs = Date.now() - start;
    return metrics;
  }
  const limit = options?.batchLimit ?? 0;
  let toProcess;
  if (limit > 0 && files.length > limit) {
    toProcess = files.slice(0, limit);
    metrics.remaining = files.length - limit;
  } else {
    toProcess = files;
  }
  for (const filename of toProcess) {
    const filePath = join3(inboxDir, filename);
    let raw;
    try {
      raw = readFileSync2(filePath, "utf-8");
    } catch {
      metrics.errors++;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      metrics.errors++;
      continue;
    }
    const event = validateInboxEvent(parsed);
    if (!event) {
      metrics.skipped++;
      continue;
    }
    if (isDuplicate(db, event.event_id)) {
      metrics.duplicates++;
      tryDelete(filePath);
      continue;
    }
    if (!captureLevelGate(event, captureLevel)) {
      metrics.filtered++;
      tryDelete(filePath);
      continue;
    }
    if (shouldDedup(event, db)) {
      metrics.duplicates++;
      tryDelete(filePath);
      continue;
    }
    const significance = classifySignificance(event);
    try {
      const payloadJson = redact(JSON.stringify(event.payload));
      const projectRoot = canonicalStoredProjectRoot(event.project_root, options?.projectRoot);
      const result = db.run(
        `INSERT INTO conversation_events
         (event_id, source, source_event_id, project_root, session_id,
          timestamp, kind, payload_json, significance, tags_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.event_id,
          event.source,
          event.source_event_id ?? null,
          projectRoot,
          event.session_id ?? null,
          event.timestamp,
          event.kind,
          payloadJson,
          significance,
          null,
          // tags_json — Phase 2 (RAKE/TF-IDF)
          Date.now()
        ]
      );
      const filePaths = extractFilePaths(event).filter((fp) => !isDenylisted(fp));
      for (const fp of filePaths) {
        db.run("INSERT INTO event_files (event_id, file_path) VALUES (?, ?)", [event.event_id, fp]);
      }
      if (fts5) {
        const ftsContent = extractFtsContent(event);
        if (ftsContent) {
          try {
            db.run("INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)", [
              result.lastInsertRowid,
              redact(ftsContent)
            ]);
          } catch {
          }
        }
      }
      recordProcessed(db, event);
      tryDelete(filePath);
      metrics.processed++;
    } catch {
      metrics.errors++;
    }
  }
  metrics.durationMs = Date.now() - start;
  return metrics;
}
function canonicalStoredProjectRoot(eventProjectRoot, currentProjectRoot) {
  const eventRoot = normalizeProjectRootForScope(eventProjectRoot);
  if (!currentProjectRoot) {
    return eventRoot;
  }
  const currentRoot = normalizeProjectRootForScope(currentProjectRoot);
  if (eventRoot === currentRoot || isInsideProjectRoot(eventRoot, currentRoot)) {
    return currentRoot;
  }
  return eventRoot;
}
function isInsideProjectRoot(eventRoot, currentRoot) {
  if (currentRoot === "/" || /^[a-z]:\/$/u.test(currentRoot)) {
    return eventRoot.startsWith(currentRoot);
  }
  return eventRoot.startsWith(`${currentRoot}/`);
}
function extractFilePaths(event) {
  const payload = event.payload;
  if (event.kind === "tool_use") {
    const files = payload.files;
    if (Array.isArray(files)) {
      return files.filter((f) => typeof f === "string");
    }
  }
  if (event.kind === "file_diff") {
    const path = payload.path;
    if (typeof path === "string" && path.length > 0) {
      return [path];
    }
  }
  return [];
}
function extractFtsContent(event) {
  const payload = event.payload;
  const parts = [event.kind];
  switch (event.kind) {
    case "user_prompt": {
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
      if (prompt) parts.push(prompt);
      break;
    }
    case "ai_response": {
      const response = typeof payload.response === "string" ? payload.response : "";
      if (response) parts.push(response);
      break;
    }
    case "tool_use": {
      const tool = typeof payload.tool === "string" ? payload.tool : "";
      if (tool) parts.push(tool);
      const files = payload.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          if (typeof f === "string" && !isDenylisted(f)) parts.push(f);
        }
      }
      break;
    }
    case "file_diff": {
      const path = typeof payload.path === "string" ? payload.path : "";
      if (path && !isDenylisted(path)) parts.push(path);
      break;
    }
    case "session_start": {
      const tool = typeof payload.tool === "string" ? payload.tool : "";
      if (tool) parts.push(tool);
      break;
    }
    case "session_end": {
      const summary = typeof payload.summary === "string" ? payload.summary : "";
      if (summary) parts.push(summary);
      break;
    }
  }
  return parts.join(" ");
}
function tryDelete(filePath) {
  try {
    unlinkSync(filePath);
  } catch {
  }
}

// packages/core/src/memory/durable.ts
function optionalProjectRoot(projectRoot) {
  const trimmed = projectRoot?.trim();
  return trimmed ? normalizeProjectRootForScope(trimmed) : null;
}
function rowToEntry(row) {
  return {
    id: row.id,
    topicKey: row.topic_key ?? void 0,
    memoryType: row.memory_type,
    state: row.state,
    summary: row.summary,
    evidence: JSON.parse(row.evidence_json),
    projectRoot: row.project_root ?? void 0,
    sourceEventId: row.source_event_id ?? void 0,
    source: row.source,
    supersededById: row.superseded_by_id ?? void 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
var DurableMemoryStore = class {
  db;
  fts5;
  constructor(db, fts5Available) {
    this.db = db;
    this.fts5 = fts5Available;
  }
  insert(input) {
    const now = Date.now();
    const projectRoot = optionalProjectRoot(input.projectRoot);
    const result = this.db.run(
      `INSERT INTO durable_memories (
        topic_key,
        memory_type,
        state,
        summary,
        evidence_json,
        project_root,
        source_event_id,
        source,
        superseded_by_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.topicKey ?? null,
        input.memoryType,
        input.state ?? "active",
        input.summary,
        JSON.stringify(input.evidence),
        projectRoot,
        input.sourceEventId ?? null,
        input.source,
        input.supersededById ?? null,
        now,
        now
      ]
    );
    const row = this.db.get("SELECT * FROM durable_memories WHERE id = ?", [
      result.lastInsertRowid
    ]);
    if (!row) {
      throw new Error("Failed to read inserted durable memory row");
    }
    if (this.fts5) {
      this.db.run("INSERT INTO durable_memories_fts(rowid, summary) VALUES (?, ?)", [
        row.id,
        row.summary
      ]);
    }
    return rowToEntry(row);
  }
  updateState(id, state, supersededById) {
    const existing = this.db.get("SELECT * FROM durable_memories WHERE id = ?", [
      id
    ]);
    if (!existing) {
      return false;
    }
    const result = this.db.run(
      "UPDATE durable_memories SET state = ?, superseded_by_id = ?, updated_at = ? WHERE id = ?",
      [state, supersededById ?? null, Date.now(), id]
    );
    return result.changes > 0;
  }
  removeById(id) {
    const existing = this.db.get("SELECT * FROM durable_memories WHERE id = ?", [
      id
    ]);
    if (!existing) {
      return false;
    }
    if (this.fts5) {
      this.db.run(
        "INSERT INTO durable_memories_fts(durable_memories_fts, rowid, summary) VALUES ('delete', ?, ?)",
        [id, existing.summary]
      );
    }
    const result = this.db.run("DELETE FROM durable_memories WHERE id = ?", [id]);
    return result.changes > 0;
  }
  listByTopic(topicKey, options) {
    const projectRoot = optionalProjectRoot(options?.projectRoot);
    if (projectRoot) {
      const rows2 = this.db.all(
        `SELECT * FROM durable_memories
         WHERE topic_key = ? AND project_root = ?
         ORDER BY updated_at DESC, id DESC`,
        [topicKey, projectRoot]
      );
      return rows2.map(rowToEntry);
    }
    const rows = this.db.all(
      "SELECT * FROM durable_memories WHERE topic_key = ? ORDER BY updated_at DESC, id DESC",
      [topicKey]
    );
    return rows.map(rowToEntry);
  }
  listByMemoryType(memoryType, options) {
    const projectRoot = optionalProjectRoot(options?.projectRoot);
    if (projectRoot) {
      const rows2 = this.db.all(
        `SELECT * FROM durable_memories
         WHERE memory_type = ? AND project_root = ?
         ORDER BY updated_at DESC, id DESC`,
        [memoryType, projectRoot]
      );
      return rows2.map(rowToEntry);
    }
    const rows = this.db.all(
      "SELECT * FROM durable_memories WHERE memory_type = ? ORDER BY updated_at DESC, id DESC",
      [memoryType]
    );
    return rows.map(rowToEntry);
  }
  listAll(limit = 100) {
    const rows = this.db.all(
      "SELECT * FROM durable_memories ORDER BY updated_at DESC, id DESC LIMIT ?",
      [limit]
    );
    return rows.map(rowToEntry);
  }
  countByState() {
    const rows = this.db.all(
      "SELECT state, COUNT(*) AS cnt FROM durable_memories GROUP BY state"
    );
    const counts = {
      active: 0,
      stale: 0,
      superseded: 0,
      archivable: 0
    };
    for (const row of rows) {
      counts[row.state] = row.cnt;
    }
    return counts;
  }
  search(query, limit = 20) {
    if (this.fts5) {
      const sanitized = sanitizeFtsQuery(query);
      if (!sanitized) {
        return [];
      }
      const rows2 = this.db.all(
        `SELECT * FROM durable_memories
         WHERE id IN (SELECT rowid FROM durable_memories_fts WHERE durable_memories_fts MATCH ?)
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        [sanitized, limit]
      );
      return rows2.map(rowToEntry);
    }
    const rows = this.db.all(
      "SELECT * FROM durable_memories WHERE summary LIKE ? ORDER BY updated_at DESC, id DESC LIMIT ?",
      [`%${query}%`, limit]
    );
    return rows.map(rowToEntry);
  }
};

// packages/core/src/memory/extractor-patterns.ts
var MIN_CONFIDENCE = 0.7;
var EXTRACTOR_PATTERNS = [
  {
    memoryType: "rejected_alternative",
    matchedPattern: "rejected-alternative-with-rationale",
    confidence: 0.92,
    reason: "rejected_alternative_with_rationale",
    regex: /\b(?:rejected|avoid(?:ed)?|declined)\b.+\b(?:because|due to|as)\b/i
  },
  {
    memoryType: "rejected_alternative",
    matchedPattern: "ru-rejected-alternative-with-rationale",
    confidence: 0.92,
    reason: "rejected_alternative_with_rationale",
    regex: /\b(?:отказались|отказаться|не используем|не использовать)\b.+\b(?:потому что|из за|так как)\b/iu
  },
  {
    memoryType: "validation_fact",
    matchedPattern: "validation-passed",
    confidence: 0.9,
    reason: "validation_fact",
    regex: /\b(?:validation passed|tests? passed|typecheck passed|проверка прошла|тесты прошли)\b/i
  },
  {
    memoryType: "next_step",
    matchedPattern: "next-step",
    confidence: 0.86,
    reason: "next_step",
    regex: /\b(?:next step|next i will|следующий шаг|дальше нужно)\b/i
  },
  {
    memoryType: "constraint",
    matchedPattern: "explicit-constraint",
    confidence: 0.88,
    reason: "explicit_constraint",
    regex: /\b(?:do not touch|must not|keep codex as the primary validation path|нельзя трогать|не трогать)\b/i
  },
  {
    memoryType: "style",
    matchedPattern: "collaboration-style",
    confidence: 0.84,
    reason: "collaboration_style",
    regex: /\b(?:surgical|avoid unrelated refactors|prove it with tests|хирургическ|без лишних рефакторинг)\b/i
  },
  {
    memoryType: "style",
    matchedPattern: "ru-work-style",
    confidence: 0.86,
    reason: "collaboration_style",
    regex: /(?:мой стиль работы|стиль работы).+(?:таск|задач|отчет|отчёт|одобрен|одобрения)/iu
  },
  {
    memoryType: "preference",
    matchedPattern: "user-preference",
    confidence: 0.84,
    reason: "user_preference",
    regex: /\b(?:i prefer|prefer one task at a time|предпочитаю|лучше по одному)\b/i
  },
  {
    memoryType: "decision",
    matchedPattern: "decision-prefix",
    confidence: 0.9,
    reason: "accepted_decision",
    regex: /(?:decision:|decided to|we decided|решили|мы решили)/iu,
    clean: (match, normalized) => normalized.slice((match.index ?? 0) + match[0].length).replace(/^[:\s-]+/, "").trim()
  },
  {
    memoryType: "decision",
    matchedPattern: "imperative-use-decision",
    confidence: 0.76,
    reason: "accepted_decision",
    regex: /^use\s+/i
  }
];
function extractPatternMatches(text) {
  const normalized = normalizeSentence(text);
  if (!normalized) {
    return [];
  }
  if (isQuestionLike(normalized)) {
    return [];
  }
  const matches = [];
  const seenTypes = /* @__PURE__ */ new Set();
  for (const pattern of EXTRACTOR_PATTERNS) {
    if (pattern.confidence < MIN_CONFIDENCE || seenTypes.has(pattern.memoryType)) {
      continue;
    }
    const match = normalized.match(pattern.regex);
    if (!match) {
      continue;
    }
    const summary = pattern.clean?.(match, normalized) || normalized;
    if (!summary) {
      continue;
    }
    matches.push({
      memoryType: pattern.memoryType,
      summary,
      matchedPattern: pattern.matchedPattern,
      confidence: pattern.confidence,
      reason: pattern.reason
    });
    seenTypes.add(pattern.memoryType);
  }
  return matches;
}
function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").trim();
}
function isQuestionLike(text) {
  return /\?\s*$/.test(text) || /^(?:what|why|how|which|кто|что|почему|какой|какие|как)\b/iu.test(text);
}

// packages/core/src/memory/topic-key-registry.ts
var TOPIC_KEY_RULES = [
  {
    key: "database_choice",
    memoryTypes: ["decision"],
    any: ["postgresql", "postgres", "sqlite", "mysql"],
    all: [
      [
        "database",
        "store",
        "storage",
        "memory",
        "db",
        "\u0431\u0430\u0437",
        "\u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449",
        "\u043F\u0430\u043C\u044F\u0442",
        "\u0440\u0435\u0448\u0438\u043B\u0438",
        "\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C"
      ]
    ]
  },
  {
    key: "auth_strategy",
    memoryTypes: ["decision"],
    any: ["oauth", "github oauth", "auth strategy", "authentication strategy"],
    all: [["auth", "authentication", "login", "\u043B\u043E\u0433\u0438\u043D", "\u0430\u0432\u0442\u043E\u0440\u0438\u0437\u0430\u0446", "\u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446"]]
  },
  {
    key: "codex_hooks_strategy",
    memoryTypes: ["decision", "rejected_alternative", "constraint"],
    any: ["hook-first", "hooks", "hook", "\u0445\u0443\u043A"],
    all: [
      ["codex", "capture", "\u0437\u0430\u0445\u0432\u0430\u0442"],
      ["reject", "rejected", "\u043E\u0442\u043A\u0430\u0437", "\u043E\u0442\u043A\u0430\u0437\u0430\u043B\u0438\u0441\u044C", "avoid"]
    ]
  },
  {
    key: "capture_strategy",
    memoryTypes: ["decision"],
    any: ["capture strategy", "capture mode", "redacted capture", "bounded redacted"],
    all: [
      ["capture", "\u0437\u0430\u0445\u0432\u0430\u0442", "memory", "\u043F\u0430\u043C\u044F\u0442", "recall"],
      ["redacted", "metadata", "full"]
    ]
  },
  {
    key: "user_workflow_style",
    memoryTypes: ["preference", "style", "constraint"],
    any: [
      "one task at a time",
      "approval gate",
      "approval gates",
      "\u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u0442\u0430\u0441\u043A\u0443",
      "\u0441\u0442\u0438\u043B\u044C \u0440\u0430\u0431\u043E\u0442\u044B",
      "\u0430\u0442\u043E\u043C\u0430\u0440\u043D\u043E\u0433\u043E \u0442\u0430\u0441\u043A\u0430"
    ],
    all: [
      ["task", "\u0442\u0430\u0441\u043A", "\u0437\u0430\u0434\u0430\u0447"],
      ["approve", "approval", "\u043E\u0434\u043E\u0431\u0440\u0435\u043D", "\u043E\u0434\u043E\u0431\u0440\u0435\u043D\u0438\u044F"]
    ]
  },
  {
    key: "track_c_acceptance",
    memoryTypes: ["next_step", "validation_fact"],
    any: ["track c", "acceptance fixtures", "acceptance matrix", "memory_recall"],
    all: [
      ["acceptance", "track c"],
      ["recall", "fixtures", "docs", "matrix"]
    ]
  },
  {
    key: "track_d_memory_reliability",
    memoryTypes: ["next_step", "validation_fact", "decision"],
    any: [
      "track d",
      "memory reliability",
      "project-scoped recall",
      "date buckets",
      "memory_calendar"
    ],
    all: [["track d", "memory", "recall"]]
  }
];
function deriveCanonicalTopicKey(input) {
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
  return void 0;
}
function normalizeSummary(summary) {
  return summary.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function includesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

// packages/core/src/memory/durable-extractor.ts
function parsePayload(payloadJson) {
  if (!payloadJson) {
    return void 0;
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    return void 0;
  }
}
function buildCandidate(event, match) {
  return {
    topicKey: deriveCanonicalTopicKey({ memoryType: match.memoryType, summary: match.summary }),
    memoryType: match.memoryType,
    summary: match.summary,
    evidence: {
      eventId: event.event_id,
      kind: event.kind,
      timestamp: event.timestamp,
      sessionId: event.session_id ?? void 0,
      matchedPattern: match.matchedPattern,
      confidence: match.confidence,
      reason: match.reason
    },
    sourceEventId: event.event_id,
    source: event.source
  };
}
function extractDurableCandidatesFromEvent(event) {
  const payload = parsePayload(event.payload_json);
  if (!payload) {
    return [];
  }
  const candidates = [];
  const summaryText = typeof payload.summary === "string" ? payload.summary : void 0;
  const promptText = typeof payload.prompt === "string" ? payload.prompt : void 0;
  const responseText = typeof payload.response === "string" ? payload.response : void 0;
  for (const text of [summaryText, promptText, responseText]) {
    if (!text) {
      continue;
    }
    for (const match of extractPatternMatches(text)) {
      if (!candidates.some((candidate) => candidate.memoryType === match.memoryType)) {
        candidates.push(buildCandidate(event, match));
      }
    }
  }
  return candidates;
}

// packages/core/src/memory/durable-merge.ts
var SUPERSEDABLE_TYPES = /* @__PURE__ */ new Set([
  "decision",
  "preference",
  "constraint",
  "next_step"
]);
function normalizeSummary2(summary) {
  return summary.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function hasMappingConfidence(candidate) {
  return typeof candidate.evidence.confidence === "number";
}
function isPositiveValidationSummary(summary) {
  const normalized = summary.toLowerCase();
  if (/\b(?:not|never|failed|failing|blocked|hasn['’]?t|haven['’]?t|isn['’]?t|wasn['’]?t)\b/u.test(
    normalized
  )) {
    return false;
  }
  return /\b(?:passed|validated|released|published|shipped|done|completed|finished|resolved)\b/u.test(
    normalized
  );
}
function mergeDurableCandidate(existingEntries, candidate) {
  const activeEntries = existingEntries.filter((entry) => entry.state === "active");
  const resolvedNextStep = activeEntries.find(
    (entry) => candidate.memoryType === "validation_fact" && entry.memoryType === "next_step" && candidate.topicKey && entry.topicKey === candidate.topicKey && isPositiveValidationSummary(candidate.summary)
  );
  if (resolvedNextStep) {
    return {
      action: "supersede_existing",
      existingId: resolvedNextStep.id
    };
  }
  const matchingEntries = activeEntries.filter((entry) => entry.memoryType === candidate.memoryType).filter((entry) => candidate.topicKey ? entry.topicKey === candidate.topicKey : true);
  const candidateSummary = normalizeSummary2(candidate.summary);
  const duplicate = matchingEntries.find(
    (entry) => normalizeSummary2(entry.summary) === candidateSummary
  );
  if (duplicate) {
    return {
      action: "confirm_existing",
      existingId: duplicate.id
    };
  }
  const firstMatchingEntry = matchingEntries[0];
  if (candidate.topicKey && hasMappingConfidence(candidate) && SUPERSEDABLE_TYPES.has(candidate.memoryType) && firstMatchingEntry) {
    return {
      action: "supersede_existing",
      existingId: firstMatchingEntry.id
    };
  }
  return { action: "insert_new_active" };
}

// packages/core/src/memory/durable-runner.ts
var WATERMARK_PREFIX = "durable";
function getWatermarkKey(source) {
  return `${WATERMARK_PREFIX}.${source}.last_event_id`;
}
function getWatermark(db, source) {
  const row = db.get("SELECT value FROM scan_state WHERE key = ?", [
    getWatermarkKey(source)
  ]);
  return Number(row?.value ?? "0") || 0;
}
function setWatermark(db, source, eventId) {
  db.run(
    `INSERT INTO scan_state(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [getWatermarkKey(source), String(eventId)]
  );
}
function loadConversationEvents(db, source, lastEventId) {
  return db.all(
    `SELECT *
     FROM conversation_events
     WHERE source = ? AND id > ?
     ORDER BY id ASC`,
    [source, lastEventId]
  );
}
function listAvailableSources(db) {
  return db.all("SELECT DISTINCT source FROM conversation_events ORDER BY source ASC").map((row) => row.source).filter((source) => source.length > 0);
}
function hasDurableFts(db) {
  const row = db.get(
    "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type = 'table' AND name = ?",
    ["durable_memories_fts"]
  );
  return (row?.cnt ?? 0) > 0;
}
function extractForSingleSource(db, store, source, metrics) {
  const lastEventId = getWatermark(db, source);
  const events = loadConversationEvents(db, source, lastEventId);
  metrics.watermarkEventId = Math.max(metrics.watermarkEventId, lastEventId);
  for (const event of events) {
    const candidates = extractDurableCandidatesFromEvent(event);
    metrics.scanned++;
    for (const candidate of candidates) {
      const projectRoot = event.project_root;
      const existingEntries = candidate.topicKey ? store.listByTopic(candidate.topicKey, { projectRoot }) : store.listByMemoryType(candidate.memoryType, { projectRoot });
      const decision = mergeDurableCandidate(existingEntries, candidate);
      switch (decision.action) {
        case "ignore":
          metrics.ignored++;
          break;
        case "confirm_existing":
          store.updateState(decision.existingId, "active");
          metrics.confirmed++;
          break;
        case "insert_new_active":
          store.insert({
            topicKey: candidate.topicKey,
            memoryType: candidate.memoryType,
            summary: candidate.summary,
            evidence: candidate.evidence,
            projectRoot,
            sourceEventId: candidate.sourceEventId,
            source: candidate.source,
            state: "active"
          });
          metrics.inserted++;
          break;
        case "supersede_existing": {
          const inserted = store.insert({
            topicKey: candidate.topicKey,
            memoryType: candidate.memoryType,
            summary: candidate.summary,
            evidence: candidate.evidence,
            projectRoot,
            sourceEventId: candidate.sourceEventId,
            source: candidate.source,
            state: "active"
          });
          store.updateState(decision.existingId, "superseded", inserted.id);
          metrics.superseded++;
          break;
        }
      }
    }
    metrics.watermarkEventId = Math.max(metrics.watermarkEventId, event.id);
    setWatermark(db, source, event.id);
  }
}
function runDurableExtraction(db, options) {
  const store = new DurableMemoryStore(db, hasDurableFts(db));
  const sources = options?.source && options.source !== "all" ? [options.source] : listAvailableSources(db);
  const metrics = {
    scanned: 0,
    inserted: 0,
    confirmed: 0,
    superseded: 0,
    ignored: 0,
    watermarkEventId: 0
  };
  for (const source of sources) {
    extractForSingleSource(db, store, source, metrics);
  }
  return metrics;
}

// packages/core/src/project-root.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync2, readdirSync as readdirSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join4, resolve } from "node:path";
var PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "*.sln",
  "composer.json",
  "Gemfile",
  "deno.json",
  "bun.lockb"
];
var defaultProjectRootDeps = {
  tryGitRoot(cwd) {
    try {
      const result = execFileSync2("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        timeout: 5e3,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      return result || null;
    } catch {
      return null;
    }
  },
  fileExists(path) {
    return existsSync2(path);
  },
  readDir(path) {
    try {
      return readdirSync2(path);
    } catch {
      return [];
    }
  },
  resolveHomeDir() {
    try {
      return homedir2();
    } catch {
      return null;
    }
  }
};
function normalizePath(p) {
  return resolve(p).replace(/\\/g, "/");
}
function hasAnyMarker(dir, markers, deps) {
  for (const marker of markers) {
    if (marker.startsWith("*")) {
      const ext = marker.slice(1);
      const entries = deps.readDir(dir);
      for (const entry of entries) {
        if (entry.endsWith(ext)) return true;
      }
    } else {
      if (deps.fileExists(join4(dir, marker))) return true;
    }
  }
  return false;
}
function resolveProjectRoot(cwd, deps = defaultProjectRootDeps) {
  const gitRoot = deps.tryGitRoot(cwd);
  if (gitRoot) return { root: normalizePath(gitRoot), method: "git-root" };
  const normalizedCwd = normalizePath(cwd);
  const homeDir = deps.resolveHomeDir();
  const normalizedHomeDir = homeDir ? normalizePath(homeDir) : null;
  let highestMarkerDir = null;
  let dir = resolve(cwd);
  for (; ; ) {
    const normalizedDir = normalizePath(dir);
    const isAncestorHomeDir = normalizedHomeDir !== null && normalizedDir === normalizedHomeDir && normalizedDir !== normalizedCwd;
    if (!isAncestorHomeDir && hasAnyMarker(dir, PROJECT_MARKERS, deps)) {
      highestMarkerDir = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (highestMarkerDir) {
    return { root: normalizePath(highestMarkerDir), method: "project-marker" };
  }
  return { root: normalizePath(cwd), method: "cwd-fallback" };
}

// packages/core/src/storage/init.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname2 } from "node:path";

// packages/core/src/storage/migrations.ts
function getCurrentVersion(db) {
  try {
    const row = db.get("SELECT version FROM schema_version");
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
function tableExists(db, name) {
  const row = db.get(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name = ?",
    [name]
  );
  return (row?.cnt ?? 0) > 0;
}
function columnExists(db, table, column) {
  return db.all(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}
function migrationV1(db, fts5) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS files (
    relative_path TEXT PRIMARY KEY,
    exports_json TEXT,
    imports_json TEXT,
    re_exports_json TEXT,
    file_type TEXT,
    language TEXT,
    lines INTEGER,
    confidence_level TEXT,
    confidence_reason TEXT,
    last_scanned INTEGER,
    skipped_reason TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    layer TEXT NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    session_id TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS hook_captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT,
    file_paths_json TEXT,
    status TEXT,
    exit_code INTEGER,
    timestamp INTEGER,
    duration_ms INTEGER,
    diff_added INTEGER,
    diff_removed INTEGER,
    error_kind TEXT,
    bash_command TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_hook_captures_timestamp ON hook_captures(timestamp)");
  db.exec(`CREATE TABLE IF NOT EXISTS scan_state (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id
    )`);
  }
  db.run("INSERT INTO schema_version (version) VALUES (?)", [1]);
}
function migrationV2(db, fts5) {
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT,
    project_root TEXT NOT NULL,
    session_id TEXT,
    timestamp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT,
    significance TEXT,
    tags_json TEXT,
    created_at INTEGER NOT NULL
  )`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_event_id ON conversation_events(event_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ce_timestamp ON conversation_events(timestamp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ce_kind ON conversation_events(kind)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ce_session ON conversation_events(session_id)");
  db.exec(`CREATE TABLE IF NOT EXISTS event_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES conversation_events(event_id)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_ef_file_path ON event_files(file_path)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ef_event_id ON event_files(event_id)");
  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      content
    )`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT,
    processed_at INTEGER NOT NULL
  )`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_il_event_id ON ingest_log(event_id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_il_source ON ingest_log(source, source_event_id)");
  db.run("UPDATE schema_version SET version = ?", [2]);
}
function migrationV3(db, fts5) {
  db.exec(`CREATE TABLE IF NOT EXISTS durable_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_key TEXT,
    memory_type TEXT NOT NULL,
    state TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    source_event_id TEXT,
    source TEXT NOT NULL,
    superseded_by_id INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_dm_topic_key ON durable_memories(topic_key)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_dm_state ON durable_memories(state)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_dm_source_event_id ON durable_memories(source_event_id)");
  if (fts5) {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS durable_memories_fts USING fts5(
      summary,
      content=durable_memories,
      content_rowid=id
    )`);
  }
  db.run("UPDATE schema_version SET version = ?", [3]);
}
function normalizeStoredProjectRoots(db, table) {
  const rows = db.all(
    `SELECT id, project_root FROM ${table} WHERE project_root IS NOT NULL`
  );
  for (const row of rows) {
    if (!row.project_root) {
      continue;
    }
    const normalized = normalizeProjectRootForScope(row.project_root);
    if (normalized !== row.project_root) {
      db.run(`UPDATE ${table} SET project_root = ? WHERE id = ?`, [normalized, row.id]);
    }
  }
}
function migrationV4(db) {
  if (!columnExists(db, "memories", "project_root")) {
    db.exec("ALTER TABLE memories ADD COLUMN project_root TEXT");
  }
  if (!columnExists(db, "durable_memories", "project_root")) {
    db.exec("ALTER TABLE durable_memories ADD COLUMN project_root TEXT");
  }
  if (!columnExists(db, "conversation_events", "project_root")) {
    throw new Error("conversation_events.project_root is required before migration v4");
  }
  normalizeStoredProjectRoots(db, "conversation_events");
  normalizeStoredProjectRoots(db, "memories");
  normalizeStoredProjectRoots(db, "durable_memories");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_memories_project_updated ON memories(project_root, updated_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_dm_project_state_topic_updated ON durable_memories(project_root, state, topic_key, updated_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_ce_project_timestamp ON conversation_events(project_root, timestamp)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_ce_project_session_timestamp ON conversation_events(project_root, session_id, timestamp)"
  );
  db.run("UPDATE schema_version SET version = ?", [4]);
}
function extractFtsFromRow(kind, payloadJson) {
  const parts = [kind];
  if (!payloadJson) return parts.join(" ");
  try {
    const payload = JSON.parse(payloadJson);
    if (typeof payload.prompt === "string" && payload.prompt) parts.push(payload.prompt);
    if (typeof payload.response === "string" && payload.response) parts.push(payload.response);
    if (typeof payload.tool === "string" && payload.tool) parts.push(payload.tool);
    if (typeof payload.command === "string" && payload.command) parts.push(payload.command);
    if (typeof payload.path === "string" && payload.path) parts.push(payload.path);
    if (typeof payload.summary === "string" && payload.summary) parts.push(payload.summary);
    if (Array.isArray(payload.files)) {
      for (const f of payload.files) {
        if (typeof f === "string") parts.push(f);
      }
    }
  } catch {
  }
  return parts.join(" ");
}
function rebuildConversationFts(db) {
  const rows = db.all("SELECT id, kind, payload_json FROM conversation_events");
  for (const row of rows) {
    const content = extractFtsFromRow(row.kind, row.payload_json);
    if (content.length > row.kind.length) {
      try {
        db.run("INSERT INTO conversation_fts(rowid, content) VALUES (?, ?)", [row.id, content]);
      } catch {
      }
    }
  }
}
function ensureFts(db, fts5) {
  if (!fts5) return;
  if (!tableExists(db, "memories_fts")) {
    db.exec(`CREATE VIRTUAL TABLE memories_fts USING fts5(
      content,
      content=memories,
      content_rowid=id
    )`);
  }
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')");
  if (!tableExists(db, "conversation_fts")) {
    db.exec("CREATE VIRTUAL TABLE conversation_fts USING fts5(content)");
    rebuildConversationFts(db);
  } else {
    const ceCount = db.get("SELECT COUNT(*) as cnt FROM conversation_events")?.cnt ?? 0;
    const cftsCount = db.get("SELECT COUNT(*) as cnt FROM conversation_fts")?.cnt ?? 0;
    if (ceCount > 0 && cftsCount === 0) {
      rebuildConversationFts(db);
    }
  }
  if (!tableExists(db, "durable_memories_fts")) {
    db.exec(`CREATE VIRTUAL TABLE durable_memories_fts USING fts5(
      summary,
      content=durable_memories,
      content_rowid=id
    )`);
  }
  db.exec("INSERT INTO durable_memories_fts(durable_memories_fts) VALUES ('rebuild')");
}
function runMigrations(db, fts5) {
  const currentVersion = getCurrentVersion(db);
  if (currentVersion < 1) {
    migrationV1(db, fts5);
  }
  if (currentVersion < 2) {
    migrationV2(db, fts5);
  }
  if (currentVersion < 3) {
    migrationV3(db, fts5);
  }
  if (currentVersion < 4) {
    migrationV4(db);
  }
  ensureFts(db, fts5);
}

// packages/core/src/storage/node-sqlite.ts
var BUSY_RETRY_DELAYS_MS = [25, 50, 100];
function isBusyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /SQLITE_BUSY|database is locked/i.test(message);
}
function sleepSync(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
var NodeSqliteAdapter = class {
  db;
  constructor(db) {
    this.db = db;
  }
  withBusyRetry(fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        return fn();
      } catch (error) {
        const delayMs = BUSY_RETRY_DELAYS_MS[attempt];
        if (delayMs === void 0 || !isBusyError(error)) {
          throw error;
        }
        sleepSync(delayMs);
      }
    }
  }
  exec(sql) {
    this.withBusyRetry(() => this.db.exec(sql));
  }
  run(sql, params) {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return {
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid)
      };
    });
  }
  get(sql, params) {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const row = params ? stmt.get(...params) : stmt.get();
      return row;
    });
  }
  all(sql, params) {
    return this.withBusyRetry(() => {
      const stmt = this.db.prepare(sql);
      const rows = params ? stmt.all(...params) : stmt.all();
      return rows;
    });
  }
  close() {
    this.db.close();
  }
};

// packages/core/src/storage/sql-js.ts
import { writeFileSync } from "node:fs";
var SAVE_DEBOUNCE_MS = 5e3;
var SqlJsAdapter = class {
  db;
  dbPath;
  saveTimer = null;
  closed = false;
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }
  exec(sql) {
    this.db.exec(sql);
    this.scheduleSave();
  }
  run(sql, params) {
    if (params && params.length > 0) {
      this.db.run(sql, params);
    } else {
      this.db.run(sql);
    }
    const changes = this.db.getRowsModified();
    const lidStmt = this.db.prepare("SELECT last_insert_rowid() AS lid");
    let lastInsertRowid = 0;
    if (lidStmt.step()) {
      const row = lidStmt.getAsObject();
      lastInsertRowid = Number(row.lid ?? 0);
    }
    lidStmt.free();
    this.scheduleSave();
    return { changes, lastInsertRowid };
  }
  get(sql, params) {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const hasRow = stmt.step();
    if (!hasRow) {
      stmt.free();
      return void 0;
    }
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  all(sql, params) {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
    this.db.close();
  }
  saveToDisk() {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }
  scheduleSave() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }
};

// packages/core/src/storage/init.ts
function detectFts5(db) {
  try {
    db.exec("CREATE VIRTUAL TABLE _fts5_test USING fts5(c)");
    db.exec("DROP TABLE _fts5_test");
    return true;
  } catch {
    return false;
  }
}
function ensureDir(dbPath) {
  const dir = dirname2(dbPath);
  if (!existsSync3(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
async function initStorage(dbPath) {
  ensureDir(dbPath);
  try {
    const nodeSqlite = await import("node:sqlite");
    const raw = new nodeSqlite.DatabaseSync(dbPath);
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA synchronous = NORMAL");
    raw.exec("PRAGMA busy_timeout = 5000");
    const db2 = new NodeSqliteAdapter(raw);
    const fts52 = detectFts5(db2);
    runMigrations(db2, fts52);
    return { db: db2, backend: "node:sqlite", fts5: fts52 };
  } catch {
  }
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  let sqlDb;
  if (existsSync3(dbPath)) {
    const fileData = readFileSync3(dbPath);
    sqlDb = new SQL.Database(new Uint8Array(fileData));
  } else {
    sqlDb = new SQL.Database();
  }
  const db = new SqlJsAdapter(sqlDb, dbPath);
  const fts5 = detectFts5(db);
  runMigrations(db, fts5);
  return { db, backend: "sql.js", fts5 };
}

// packages/cli/src/commands/context.ts
function resolveCaptureLevel(env) {
  const raw = env.LOCUS_CAPTURE_LEVEL;
  if (raw === "metadata" || raw === "redacted" || raw === "full") {
    return raw;
  }
  return "metadata";
}
function withScopedEnv(overrides, fn) {
  if (!overrides) {
    return fn();
  }
  const savedEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === void 0) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return fn().finally(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === void 0) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}
async function runContextCommand(options = {}) {
  const mode = options.mode ?? "session-start";
  if (mode !== "session-start" && mode !== "prompt") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported context mode: ${mode}. Expected "session-start" or "prompt".`
    };
  }
  if (mode === "prompt" && (!options.prompt || options.prompt.trim().length === 0)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Option --prompt <text> is required when --mode prompt is used."
    };
  }
  if (options.maxTokens !== void 0 && (!Number.isInteger(options.maxTokens) || options.maxTokens <= 0)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Option --max-tokens must be a positive integer."
    };
  }
  return withScopedEnv(options.env, async () => {
    const cwd = options.cwd?.trim() || process.cwd();
    const { root: projectRoot } = resolveProjectRoot(cwd);
    const dbPath = resolveDbPath(projectRoot);
    const inboxDir = resolveInboxDir(projectRoot);
    const captureLevel = resolveCaptureLevel(process.env);
    const { db, fts5 } = await initStorage(dbPath);
    try {
      try {
        processInbox(inboxDir, db, {
          batchLimit: 50,
          captureLevel,
          fts5Available: fts5,
          projectRoot
        });
        runDurableExtraction(db);
      } catch {
      }
      const brief = mode === "session-start" ? buildSessionStartBrief(
        { db, projectRoot },
        options.maxTokens !== void 0 ? { maxTokens: options.maxTokens } : void 0
      ) : buildPromptRecallBrief(
        options.prompt ?? "",
        { db, projectRoot },
        options.maxTokens !== void 0 ? { maxTokens: options.maxTokens } : void 0
      );
      const stdout = options.json ? JSON.stringify(brief) : brief.injected ? brief.text : "";
      return {
        exitCode: 0,
        stdout
      };
    } finally {
      try {
        db.close();
      } catch {
      }
    }
  });
}

// packages/cli/src/codex/config.ts
import { copyFileSync, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
var defaultCodexMcpEnv = {
  LOCUS_LOG: "error",
  LOCUS_CODEX_CAPTURE: "redacted",
  LOCUS_CAPTURE_LEVEL: "redacted"
};
function classifyMcpOwnership(config) {
  if (!config) {
    return "missing";
  }
  const command = config.command ?? "";
  const args = config.args ?? [];
  const joinedArgs = args.join(" ");
  if (/^npx(?:\.cmd)?$/i.test(command) && args.some((arg) => /^locus-memory@/.test(arg))) {
    return "package-owned";
  }
  if (/^npm(?:\.cmd)?$/i.test(command) && args.includes("exec") && args.includes("--package") && args.some((arg) => isLocusMemoryPackageSpecifier(arg))) {
    return "package-owned";
  }
  if (command === "node" && /dist[\\/]+server\.js/i.test(joinedArgs)) {
    return "manual-locus";
  }
  return "foreign-locus";
}
function isLocusMemoryPackageSpecifier(value) {
  return /^locus-memory@/.test(value) || /(?:^|[\\/])locus-memory-\d+\.\d+\.\d+(?:[-+\w.]*)?\.tgz$/iu.test(value);
}
function parseCodexMcpGetOutput(output) {
  if (!output.trim()) {
    return void 0;
  }
  const command = output.match(/^\s*command:\s*(.+)$/im)?.[1]?.trim();
  const argsLine = output.match(/^\s*args:\s*(.*)$/im)?.[1]?.trim();
  const cwdLine = output.match(/^\s*cwd:\s*(.*)$/im)?.[1]?.trim();
  return {
    command,
    args: argsLine ? argsLine.split(/\s+/) : [],
    cwd: cwdLine && cwdLine !== "-" ? cwdLine : void 0
  };
}
function quoteTomlBasicString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function createConfigBackup(configPath, now = /* @__PURE__ */ new Date()) {
  const backupPath = `${configPath}.${timestamp(now)}.bak`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}
function setMcpServerCwd(configPath, name, cwd, now = /* @__PURE__ */ new Date()) {
  const text = readFileSync4(configPath, "utf8");
  const headerPattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp2(name)}\\]\\s*$`, "m");
  const headerMatch = headerPattern.exec(text);
  if (!headerMatch) {
    return { action: "missing" };
  }
  const sectionStart = headerMatch.index;
  const afterHeader = sectionStart + headerMatch[0].length;
  const nextSectionMatch = /^\[/m.exec(text.slice(afterHeader));
  const sectionEnd = nextSectionMatch ? afterHeader + nextSectionMatch.index : text.length;
  const before = text.slice(0, sectionStart);
  const section = text.slice(sectionStart, sectionEnd);
  const after = text.slice(sectionEnd);
  const cwdLine = `cwd = ${quoteTomlBasicString(cwd)}`;
  const backupPath = createConfigBackup(configPath, now);
  let updatedSection;
  if (/^cwd\s*=/m.test(section)) {
    updatedSection = section.replace(/^cwd\s*=.*$/m, cwdLine);
  } else if (/^args\s*=/m.test(section)) {
    updatedSection = section.replace(/^(args\s*=.*)$/m, `$1
${cwdLine}`);
  } else {
    updatedSection = section.replace(/^(\[mcp_servers\.[^\]]+\])\s*$/m, `$1
${cwdLine}`);
  }
  writeFileSync2(configPath, `${before}${updatedSection}${after}`, "utf8");
  return { action: "updated", backupPath };
}
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function timestamp(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

// packages/cli/src/codex/hooks.ts
import {
  copyFileSync as copyFileSync2,
  existsSync as existsSync5,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync6,
  renameSync,
  writeFileSync as writeFileSync3
} from "node:fs";
import { dirname as dirname4, join as join6 } from "node:path";

// packages/cli/src/package-info.ts
import { existsSync as existsSync4, readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname3, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function findPackageRoot(startDir = dirname3(fileURLToPath2(import.meta.url))) {
  let current = resolve2(startDir);
  while (true) {
    const packagePath = resolve2(current, "package.json");
    if (existsSync4(packagePath)) {
      const packageJson = JSON.parse(readFileSync5(packagePath, "utf8"));
      if (packageJson.name === "locus-memory") {
        return current;
      }
    }
    const parent = dirname3(current);
    if (parent === current) {
      throw new Error(`Could not find locus-memory package root from ${startDir}`);
    }
    current = parent;
  }
}
function resolvePackageVersion(startDir = dirname3(fileURLToPath2(import.meta.url))) {
  try {
    const root = findPackageRoot(startDir);
    const packageJson = JSON.parse(
      readFileSync5(resolve2(root, "package.json"), "utf8")
    );
    if (!packageJson.version) {
      throw new Error("Root package.json is missing version");
    }
    return packageJson.version;
  } catch (error) {
    const runtimeManifestPath = resolve2(resolve2(startDir), "runtime.json");
    if (existsSync4(runtimeManifestPath)) {
      const manifest = JSON.parse(readFileSync5(runtimeManifestPath, "utf8"));
      if (typeof manifest.version === "string" && manifest.version.trim().length > 0) {
        return manifest.version.trim();
      }
    }
    throw error;
  }
}
function buildRuntimePackageSpecifier(version) {
  return `locus-memory@${version}`;
}
function resolveRuntimePackageOverride(env = process.env) {
  const value = env.LOCUS_CODEX_RUNTIME_PACKAGE?.trim();
  return value ? value : void 0;
}

// packages/cli/src/codex/paths.ts
import { homedir as homedir3 } from "node:os";
import { join as join5, resolve as resolve3 } from "node:path";
function resolveCodexHome(env = process.env) {
  const configured = env.CODEX_HOME;
  if (configured && configured.trim().length > 0) {
    return resolve3(expandTilde2(configured));
  }
  return join5(homedir3(), ".codex");
}
function resolveCodexConfigPath(env = process.env) {
  return join5(resolveCodexHome(env), "config.toml");
}
function resolveCodexSkillPath(env = process.env, skillName = "locus-memory") {
  return join5(resolveCodexHome(env), "skills", skillName, "SKILL.md");
}
function expandTilde2(pathValue) {
  if (pathValue === "~") {
    return homedir3();
  }
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join5(homedir3(), pathValue.slice(2));
  }
  return pathValue;
}

// packages/cli/src/codex/hooks.ts
var hookEvents = [
  {
    configEvent: "SessionStart",
    commandEvent: "session-start",
    matcher: "startup|resume|clear",
    statusMessage: "Preparing Locus recall freshness"
  },
  {
    configEvent: "UserPromptSubmit",
    commandEvent: "user-prompt-submit",
    statusMessage: "Notifying Locus about a new prompt"
  },
  {
    configEvent: "Stop",
    commandEvent: "stop",
    statusMessage: "Notifying Locus that the turn stopped"
  }
];
function buildCodexHooksConfig(options) {
  const timeout = options.timeoutSeconds ?? 3;
  const hooks = {};
  for (const event of hookEvents) {
    hooks[event.configEvent] = [
      {
        ...event.matcher ? { matcher: event.matcher } : {},
        hooks: [
          {
            type: "command",
            command: buildCodexHookCommand({
              event: event.commandEvent,
              version: options.version,
              platform: options.platform,
              binaryPath: options.binaryPath
            }),
            timeout,
            statusMessage: event.statusMessage
          }
        ]
      }
    ];
  }
  return { hooks };
}
function buildCodexHookCommand(options) {
  const command = options.binaryPath ?? (options.platform === "win32" ? "npx.cmd" : "npx");
  const args = options.binaryPath ? ["hook", "codex", options.event] : [
    "-y",
    buildRuntimePackageSpecifier(requiredVersion(options.version)),
    "hook",
    "codex",
    options.event
  ];
  return [command, ...args].map(quoteShellArg).join(" ");
}
function renderCodexHooksJson(config) {
  return `${JSON.stringify(config, null, 2)}
`;
}
function resolveCodexHooksPath(env = process.env) {
  return join6(resolveCodexHome(env), "hooks.json");
}
function installCodexHooks(options) {
  const hooksPath = resolveCodexHooksPath(options.env);
  const next = renderCodexHooksJson(
    buildCodexHooksConfig({
      version: options.version,
      platform: options.platform
    })
  );
  if (existsSync5(hooksPath)) {
    const current = readFileSync6(hooksPath, "utf8");
    if (current === next) {
      return { action: "unchanged", path: hooksPath };
    }
    const backupPath = `${hooksPath}.${timestamp2(options.now ?? /* @__PURE__ */ new Date())}.bak`;
    copyFileSync2(hooksPath, backupPath);
    writeHooksFileAtomically(hooksPath, next);
    return { action: "updated", path: hooksPath, backupPath };
  }
  writeHooksFileAtomically(hooksPath, next);
  return { action: "created", path: hooksPath };
}
function inspectCodexHooks(options = {}) {
  const hooksPath = resolveCodexHooksPath(options.env);
  if (!existsSync5(hooksPath)) {
    return { status: "not configured", path: hooksPath };
  }
  const text = readFileSync6(hooksPath, "utf8");
  return {
    status: hasLocusHookCommand(text) ? "configured" : "not configured",
    path: hooksPath
  };
}
function requiredVersion(version) {
  if (!version || version.trim().length === 0) {
    throw new Error("Codex hook config requires a pinned locus-memory version");
  }
  return version;
}
function quoteShellArg(value) {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}
function hasLocusHookCommand(text) {
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
      return false;
    }
    return Object.values(parsed.hooks).some((groups) => {
      if (!Array.isArray(groups)) {
        return false;
      }
      return groups.some((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
          return false;
        }
        return group.hooks.some((handler) => {
          if (!isRecord(handler) || handler.type !== "command") {
            return false;
          }
          return isLocusHookCommand(handler.command);
        });
      });
    });
  } catch {
    return false;
  }
}
function isLocusHookCommand(command) {
  if (typeof command !== "string") {
    return false;
  }
  return /\blocus-memory(?:\.cmd)?(?:@[\w.-]+)?\b/u.test(command) && /\bhook codex\b/u.test(command);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function writeHooksFileAtomically(path, text) {
  mkdirSync2(dirname4(path), { recursive: true });
  const tempPath = `${path}.locus-tmp`;
  writeFileSync3(tempPath, text, "utf8");
  renameSync(tempPath, path);
}
function timestamp2(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

// packages/cli/src/commands/doctor-codex.ts
async function formatDoctorCodex(options) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const codexCommandOptions = { env: { CODEX_HOME: codexHome } };
  const version = resolvePackageVersion(options.startDir);
  const codexVersion = await options.commandRunner("codex", ["--version"], codexCommandOptions);
  const hookFeature = await options.commandRunner(
    "codex",
    ["features", "list"],
    codexCommandOptions
  );
  const config = options.readMcpServer?.() ?? parseCodexMcpGetOutput(
    (await options.commandRunner("codex", ["mcp", "get", "locus"], codexCommandOptions)).stdout
  );
  const ownership = classifyMcpOwnership(config);
  const hooks = inspectCodexHooks({ env });
  const hookStatus = hookFeature.exitCode !== 0 || !codexSupportsHooks(hookFeature.stdout) ? "unavailable" : hooks.status;
  return [
    "Locus Codex doctor",
    `Node version: ${process.version}`,
    `Codex version: ${codexVersion.exitCode === 0 ? codexVersion.stdout.trim() : "unavailable"}`,
    `Codex home: ${codexHome}`,
    `Codex config: ${resolveCodexConfigPath(env)}`,
    `Skill path: ${resolveCodexSkillPath(env, "locus-memory")}`,
    `Runtime package: ${buildRuntimePackageSpecifier(version)}`,
    "Cache warming: not attempted by doctor",
    "Network: first run after cache cleanup requires network access",
    `Ownership: ${ownership}`,
    `Hooks: ${hookStatus}`,
    `Hooks path: ${hooks.path}`
  ].join("\n");
}
function codexSupportsHooks(featuresList) {
  return /^hooks\s+\S+\s+true\s*$/imu.test(featuresList);
}

// packages/cli/src/commands/hook-codex.ts
import { randomBytes } from "node:crypto";
import { mkdirSync as mkdirSync3, renameSync as renameSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join7 } from "node:path";
var supportedEvents = /* @__PURE__ */ new Set(["session-start", "user-prompt-submit", "stop"]);
function runCodexHook(options) {
  const event = options.event;
  if (!isSupportedEvent(event)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unsupported Codex hook event: ${event ?? "(missing)"}`
    };
  }
  const parsed = parseHookInput(options.stdin);
  if (!parsed.ok) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ continue: true, suppressOutput: true }),
      stderr: "malformed Codex hook input; failing open"
    };
  }
  if (event === "stop") {
    const writeResult = writeStopTrigger({
      env: options.env,
      input: parsed.value,
      now: options.now ?? /* @__PURE__ */ new Date()
    });
    if (!writeResult.ok) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({ continue: true, suppressOutput: true }),
        stderr: `could not write Codex hook trigger; failing open: ${writeResult.error.message}`
      };
    }
  }
  return {
    exitCode: 0,
    stdout: JSON.stringify({ continue: true, suppressOutput: true })
  };
}
function isSupportedEvent(event) {
  return typeof event === "string" && supportedEvents.has(event);
}
function parseHookInput(stdin) {
  if (!stdin || stdin.trim().length === 0) {
    return { ok: true, value: {} };
  }
  try {
    const value = JSON.parse(stdin);
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: true, value: {} };
  } catch {
    return { ok: false };
  }
}
function writeStopTrigger(options) {
  try {
    const triggerDir = join7(resolveCodexHome(options.env), "locus", "hook-triggers");
    mkdirSync3(triggerDir, { recursive: true });
    const id = `${options.now.getTime()}-${randomBytes(4).toString("hex")}`;
    const finalPath = join7(triggerDir, `stop-${id}.json`);
    const tempPath = `${finalPath}.tmp`;
    const payload = {
      event: "stop",
      createdAt: options.now.toISOString(),
      sessionId: stringField(options.input.session_id),
      turnId: stringField(options.input.turn_id)
    };
    writeFileSync4(tempPath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
    renameSync2(tempPath, finalPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
function stringField(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}

// packages/cli/src/commands/install-codex.ts
import { existsSync as existsSync12 } from "node:fs";
import { join as join15 } from "node:path";

// packages/cli/src/codex/cleanup.ts
import { existsSync as existsSync6, readdirSync as readdirSync3, rmSync, statSync } from "node:fs";
import { join as join8 } from "node:path";
function cleanupInterruptedInstall(codexHome) {
  const removed = [];
  const tempFiles = findInterruptedInstallTempFiles(codexHome);
  for (const path of tempFiles) {
    rmSync(path, { force: true });
    removed.push(path);
  }
  return { removed };
}
function findInterruptedInstallTempFiles(codexHome) {
  const skillDir = join8(codexHome, "skills", "locus-memory");
  const tempFiles = [];
  if (!existsSync6(skillDir)) {
    return tempFiles;
  }
  for (const entry of readdirSync3(skillDir)) {
    if (!entry.endsWith(".locus-tmp")) {
      continue;
    }
    const path = join8(skillDir, entry);
    if (!statSync(path).isFile()) {
      continue;
    }
    tempFiles.push(path);
  }
  return tempFiles;
}

// packages/cli/src/codex/commands.ts
function detectNpxCommand(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}
function detectNpmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}
function buildCodexMcpRuntimeCommand(options) {
  if (options.runtimePackage) {
    return {
      command: detectNpmCommand(options.platform),
      args: ["exec", "--yes", "--package", options.runtimePackage, "--", "locus-memory", "mcp"]
    };
  }
  return {
    command: detectNpxCommand(options.platform),
    args: ["-y", `locus-memory@${options.version}`, "mcp"]
  };
}
function buildCodexMcpAddArgs(options) {
  const env = options.env ?? defaultCodexMcpEnv;
  const runtime = buildCodexMcpRuntimeCommand(options);
  const args = ["mcp", "add"];
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(options.name, "--", runtime.command, ...runtime.args);
  return args;
}
function buildCodexMcpRemoveArgs(name) {
  return ["mcp", "remove", name];
}

// packages/cli/src/codex/lock.ts
import { existsSync as existsSync7, mkdirSync as mkdirSync4, readFileSync as readFileSync7, rmSync as rmSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { join as join9 } from "node:path";
var defaultStaleAfterMs = 15 * 60 * 1e3;
function acquireInstallLock(codexHome, options = {}) {
  mkdirSync4(codexHome, { recursive: true });
  const lockPath = join9(codexHome, ".locus-install.lock");
  if (existsSync7(lockPath)) {
    const stale = isStaleLock(lockPath, options);
    return {
      acquired: false,
      path: lockPath,
      reason: stale ? "stale" : "active",
      message: stale ? `Stale Locus install lock found at ${lockPath}. Remove it after confirming no installer is running.` : `Another Locus installer is already running: ${lockPath}`
    };
  }
  try {
    writeFileSync5(
      lockPath,
      JSON.stringify(
        {
          pid: process.pid,
          createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString()
        },
        null,
        2
      ),
      { encoding: "utf8", flag: "wx" }
    );
  } catch (error) {
    const code = error.code;
    return {
      acquired: false,
      path: lockPath,
      reason: code === "EACCES" || code === "EPERM" ? "permission_denied" : "active",
      message: error instanceof Error ? error.message : String(error)
    };
  }
  return {
    acquired: true,
    path: lockPath,
    release: () => {
      rmSync2(lockPath, { force: true });
    }
  };
}
function isStaleLock(lockPath, options) {
  const staleAfterMs = options.staleAfterMs ?? defaultStaleAfterMs;
  const now = options.now ?? /* @__PURE__ */ new Date();
  try {
    const lock = JSON.parse(readFileSync7(lockPath, "utf8"));
    if (!lock.createdAt) {
      return false;
    }
    return now.getTime() - new Date(lock.createdAt).getTime() > staleAfterMs;
  } catch {
    return false;
  }
}

// packages/cli/src/codex/skill.ts
import {
  copyFileSync as copyFileSync5,
  existsSync as existsSync11,
  mkdirSync as mkdirSync8,
  readFileSync as readFileSync11,
  renameSync as renameSync4,
  writeFileSync as writeFileSync8
} from "node:fs";
import { dirname as dirname7 } from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";

// packages/codex/src/ids.ts
import { createHash as createHash2 } from "node:crypto";
import { basename as basename2 } from "node:path";

// packages/codex/src/importer.ts
import { readFileSync as readFileSync8 } from "node:fs";

// packages/codex/src/inbox-writer.ts
import { existsSync as existsSync8, mkdirSync as mkdirSync5, renameSync as renameSync3, writeFileSync as writeFileSync6 } from "node:fs";
import { join as join10 } from "node:path";

// packages/codex/src/paths.ts
import { homedir as homedir4 } from "node:os";
import { join as join11, resolve as resolve4 } from "node:path";

// packages/codex/src/session-files.ts
import { readdirSync as readdirSync4 } from "node:fs";
import { basename as basename3, join as join12, resolve as resolve5 } from "node:path";

// packages/codex/src/plugin-sync.ts
import { copyFileSync as copyFileSync3, existsSync as existsSync9, mkdirSync as mkdirSync6, readFileSync as readFileSync9, rmSync as rmSync3, writeFileSync as writeFileSync7 } from "node:fs";
import { dirname as dirname5, join as join13, resolve as resolve6 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// packages/codex/src/skill-sync.ts
import { copyFileSync as copyFileSync4, existsSync as existsSync10, mkdirSync as mkdirSync7, readFileSync as readFileSync10 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { dirname as dirname6, join as join14, resolve as resolve7 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
function resolveCanonicalCodexSkillPath() {
  return resolve7(fileURLToPath4(new URL("../skills/locus-memory/SKILL.md", import.meta.url)));
}

// packages/cli/src/codex/skill.ts
function installCodexSkill(options = {}) {
  const sourcePath = options.sourcePath ?? resolvePackagedCodexSkillPath();
  const targetPath = resolveCodexSkillPath(options.env, "locus-memory");
  const sourceContent = readFileSync11(sourcePath, "utf8");
  try {
    mkdirSync8(dirname7(targetPath), { recursive: true });
    if (existsSync11(targetPath)) {
      const targetContent = readFileSync11(targetPath, "utf8");
      if (targetContent === sourceContent) {
        return { action: "unchanged", path: targetPath, targetPath };
      }
      if (!options.overwrite) {
        return {
          action: "skipped",
          path: targetPath,
          targetPath,
          message: "Installed Codex skill differs; rerun with overwrite enabled."
        };
      }
      const backup = options.backup ? backupSkill(targetPath, options.now ?? /* @__PURE__ */ new Date()) : void 0;
      writeAtomically(targetPath, sourceContent, options.writeFile);
      return {
        action: "updated",
        path: targetPath,
        targetPath,
        backup
      };
    }
    writeAtomically(targetPath, sourceContent, options.writeFile);
    return { action: "created", path: targetPath, targetPath };
  } catch (error) {
    return {
      action: "skipped",
      path: targetPath,
      targetPath,
      error: {
        code: isPermissionError(error) ? "permission_denied" : "permission_denied",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
function resolvePackagedCodexSkillPath() {
  const candidates = [
    resolveCanonicalCodexSkillPath(),
    fileURLToPath5(new URL("../packages/codex/skills/locus-memory/SKILL.md", import.meta.url))
  ];
  for (const candidate of candidates) {
    if (existsSync11(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? resolveCanonicalCodexSkillPath();
}
function backupSkill(targetPath, now) {
  const backupPath = `${targetPath}.${timestamp3(now)}.bak`;
  copyFileSync5(targetPath, backupPath);
  return {
    action: "backed_up",
    path: backupPath
  };
}
function writeAtomically(targetPath, content, writeFile = writeFileSync8) {
  const tempPath = `${targetPath}.locus-tmp`;
  writeFile(tempPath, content, "utf8");
  renameSync4(tempPath, targetPath);
}
function timestamp3(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}
function isPermissionError(error) {
  const code = error.code;
  return code === "EACCES" || code === "EPERM";
}

// packages/cli/src/commands/install-codex.ts
function formatInstallCodexDryRun(options = {}) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const skillPath = resolveCodexSkillPath(env, "locus-memory");
  const runtimePackage = resolveRuntimePackageOverride(env);
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));
  const lockPath = join15(codexHome, ".locus-install.lock");
  const tempFiles = findInterruptedInstallTempFiles(codexHome);
  return [
    "Locus Codex install dry-run",
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: ${formatRuntimeCommand(runtimeSpecifier, runtimePackage)}`,
    `MCP cwd: ${codexHome}`,
    `Hooks path: ${resolveCodexHooksPath(env)}`,
    `Hooks: ${options.withHooks ? "requested (would install)" : "not requested"}`,
    "Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error",
    `Install lock: ${existsSync12(lockPath) ? `present at ${lockPath}` : "none"}`,
    `Stale temp files: ${tempFiles.length}`
  ].join("\n");
}
async function runInstallCodex(options) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const codexCommandOptions = { env: { CODEX_HOME: codexHome } };
  const mcpEnv = { CODEX_HOME: codexHome, ...defaultCodexMcpEnv };
  const version = resolvePackageVersion(options.startDir);
  const runtimeSpecifier = buildRuntimePackageSpecifier(version);
  const runtimePackage = resolveRuntimePackageOverride(env);
  const lock = acquireInstallLock(codexHome);
  if (!lock.acquired) {
    return {
      exitCode: 1,
      output: lock.message ?? `Could not acquire install lock: ${lock.path}`
    };
  }
  try {
    const cleanup = cleanupInterruptedInstall(codexHome);
    const cacheResult = await options.commandRunner(
      "npm",
      buildRuntimeAvailabilityArgs(runtimeSpecifier, runtimePackage),
      { cwd: codexHome, env: { CODEX_HOME: codexHome } }
    );
    if (cacheResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          `Runtime package unavailable: ${runtimePackage ?? runtimeSpecifier}`,
          "No Codex MCP config was changed.",
          "This is expected before the package is published to npm unless it already exists in the npm cache.",
          cacheResult.stderr.trim()
        ].filter(Boolean).join("\n")
      };
    }
    const existing = await options.commandRunner(
      "codex",
      ["mcp", "get", "locus"],
      codexCommandOptions
    );
    const ownership = classifyMcpOwnership(
      existing.exitCode === 0 ? parseCodexMcpGetOutput(existing.stdout) : void 0
    );
    if (ownership === "foreign-locus") {
      return {
        exitCode: 1,
        output: "Existing MCP entry: foreign-locus\nRefusing to overwrite a non-Locus Codex MCP entry named locus."
      };
    }
    if (ownership === "manual-locus" || ownership === "package-owned") {
      const removeResult = await options.commandRunner(
        "codex",
        ["mcp", "remove", "locus"],
        codexCommandOptions
      );
      if (removeResult.exitCode !== 0) {
        return {
          exitCode: 1,
          output: [
            `Existing MCP entry: ${ownership}`,
            "Partial state: existing MCP entry was not changed because removal failed.",
            removeResult.stderr.trim()
          ].join("\n")
        };
      }
    }
    const addResult = await options.commandRunner(
      "codex",
      buildCodexMcpAddArgs({
        name: "locus",
        version,
        runtimePackage,
        platform: options.platform,
        env: mcpEnv
      }),
      codexCommandOptions
    );
    if (addResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          "Partial state: no skill was installed because Codex MCP configuration failed.",
          `Remediation: codex mcp add locus -- ${formatRuntimeCommand(
            runtimeSpecifier,
            runtimePackage
          )}`,
          addResult.stderr.trim()
        ].join("\n")
      };
    }
    const cwdResult = setMcpServerCwd(resolveCodexConfigPath(env), "locus", codexHome);
    const skill = installCodexSkill({ env, overwrite: true, backup: true });
    const hooks = options.withHooks ? installCodexHooks({ env, version, platform: options.platform }) : void 0;
    return {
      exitCode: skill.error ? 1 : 0,
      output: [
        "Locus Codex install complete",
        `Existing MCP entry: ${ownership}`,
        `Cleanup: removed ${cleanup.removed.length} stale temp file(s)`,
        `MCP: ${addResult.exitCode === 0 ? "configured" : "failed"}`,
        `MCP cwd: ${cwdResult.action === "updated" ? codexHome : "not updated"}`,
        cwdResult.backupPath ? `Config backup: ${cwdResult.backupPath}` : void 0,
        `Runtime cache: ${cacheResult.exitCode === 0 ? "warmed" : "skipped"}`,
        `Skill: ${skill.action}`,
        `Skill path: ${skill.targetPath}`,
        skill.backup ? `Backup: ${skill.backup.path}` : void 0,
        hooks ? `Hooks: ${hooks.action}` : "Hooks: not requested",
        hooks ? `Hooks path: ${hooks.path}` : void 0,
        hooks?.backupPath ? `Hooks backup: ${hooks.backupPath}` : void 0,
        skill.error ? `Error: ${skill.error.message}` : void 0
      ].filter((line) => Boolean(line)).join("\n")
    };
  } finally {
    lock.release?.();
  }
}
function buildRuntimeAvailabilityArgs(runtimeSpecifier, runtimePackage) {
  if (runtimePackage) {
    return ["exec", "--yes", "--package", runtimePackage, "--", "locus-memory", "--help"];
  }
  return ["exec", "-y", runtimeSpecifier, "--", "--help"];
}
function formatRuntimeCommand(runtimeSpecifier, runtimePackage) {
  if (runtimePackage) {
    return `npm exec --yes --package ${runtimePackage} -- locus-memory mcp`;
  }
  return `npx -y ${runtimeSpecifier} mcp`;
}

// packages/cli/src/commands/mcp.ts
async function runMcp() {
  await import(new URL("./server.js", import.meta.url).href);
  return 0;
}

// packages/cli/src/commands/runner.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var defaultCommandRunner = async (command, args, options) => {
  try {
    const [resolvedCommand, resolvedArgs] = resolveCommandForPlatform(command, args);
    const result = await execFileAsync(resolvedCommand, resolvedArgs, {
      encoding: "utf8",
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : void 0,
      windowsHide: true
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const execError = error;
    return {
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message
    };
  }
};
function resolveCommandForPlatform(command, args) {
  if (process.platform !== "win32") {
    return [command, args];
  }
  return [
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", buildWindowsCommandLine(command, args)]
  ];
}
function buildWindowsCommandLine(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}
function quoteWindowsArg(value) {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

// packages/cli/src/commands/uninstall-codex.ts
async function runUninstallCodex(options) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const codexCommandOptions = { env: { CODEX_HOME: codexHome } };
  const config = options.readMcpServer?.() ?? parseCodexMcpGetOutput(
    (await options.commandRunner("codex", ["mcp", "get", "locus"], codexCommandOptions)).stdout
  );
  const ownership = classifyMcpOwnership(config);
  const lines = [`Ownership: ${ownership}`];
  if (ownership === "package-owned") {
    const result = await options.commandRunner(
      "codex",
      buildCodexMcpRemoveArgs("locus"),
      codexCommandOptions
    );
    if (result.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [`Failed to remove Codex MCP entry: ${result.stderr.trim()}`].join("\n")
      };
    }
    lines.push("MCP entry removed: locus");
  } else {
    lines.push("MCP entry not removed automatically.");
  }
  lines.push(`Skill preserved: ${resolveCodexSkillPath(env, "locus-memory")}`);
  lines.push("Memory data untouched.");
  return { exitCode: 0, output: lines.join("\n") };
}

// packages/cli/src/runtime-install.ts
import { existsSync as existsSync13, mkdirSync as mkdirSync9, readFileSync as readFileSync12, renameSync as renameSync5, writeFileSync as writeFileSync9 } from "node:fs";
import { dirname as dirname8, join as join16 } from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";
function resolveDefaultSourceDistDir(startDir) {
  const currentDir = dirname8(fileURLToPath6(import.meta.url));
  if (existsSync13(join16(currentDir, "cli.js")) && existsSync13(join16(currentDir, "server.js"))) {
    return currentDir;
  }
  return join16(findPackageRoot(startDir), "dist");
}
function writeFileAtomically(targetPath, content) {
  mkdirSync9(dirname8(targetPath), { recursive: true });
  const tempPath = `${targetPath}.locus-tmp`;
  writeFileSync9(tempPath, content);
  renameSync5(tempPath, targetPath);
}
function syncFileAtomically(sourcePath, targetPath) {
  const nextBytes = readFileSync12(sourcePath);
  if (existsSync13(targetPath)) {
    try {
      const currentBytes = readFileSync12(targetPath);
      if (nextBytes.equals(currentBytes)) {
        return false;
      }
    } catch {
    }
  }
  writeFileAtomically(targetPath, nextBytes);
  return true;
}
function readExistingManifest(manifestPath) {
  if (!existsSync13(manifestPath)) {
    return void 0;
  }
  try {
    return JSON.parse(readFileSync12(manifestPath, "utf8"));
  } catch {
    return void 0;
  }
}
function installLocalCliRuntime(options = {}) {
  const sourceDistDir = options.sourceDistDir ?? resolveDefaultSourceDistDir(options.startDir);
  const sourceCliPath = join16(sourceDistDir, "cli.js");
  const sourceServerPath = join16(sourceDistDir, "server.js");
  if (!existsSync13(sourceCliPath) || !existsSync13(sourceServerPath)) {
    throw new Error(
      `Missing built runtime artifacts in ${sourceDistDir} (expected cli.js and server.js). Run npm run build first.`
    );
  }
  const binDir = resolveRuntimeBinDir(options.env);
  const cliPath = join16(binDir, "cli.js");
  const serverPath = join16(binDir, "server.js");
  const manifestPath = join16(binDir, "runtime.json");
  const packageJsonPath = join16(binDir, "package.json");
  const version = resolvePackageVersion(options.startDir);
  const hadAllTargets = existsSync13(cliPath) && existsSync13(serverPath) && existsSync13(manifestPath) && existsSync13(packageJsonPath);
  const existingManifest = readExistingManifest(manifestPath);
  mkdirSync9(binDir, { recursive: true });
  const cliChanged = syncFileAtomically(sourceCliPath, cliPath);
  const serverChanged = syncFileAtomically(sourceServerPath, serverPath);
  const expectedPackageJson = `${JSON.stringify(
    { name: "locus-local-runtime", private: true, type: "module" },
    null,
    2
  )}
`;
  let packageJsonChanged = false;
  if (!existsSync13(packageJsonPath) || readFileSync12(packageJsonPath, "utf8") !== expectedPackageJson) {
    writeFileAtomically(packageJsonPath, expectedPackageJson);
    packageJsonChanged = true;
  }
  const manifestOutdated = !existingManifest || existingManifest.version !== version || existingManifest.cliPath !== cliPath || existingManifest.serverPath !== serverPath;
  const manifestChanged = cliChanged || serverChanged || packageJsonChanged || manifestOutdated;
  if (manifestChanged) {
    const manifest = {
      version,
      installedAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
      cliPath,
      serverPath
    };
    writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}
`);
  }
  let action = "unchanged";
  if (!hadAllTargets) {
    action = "installed";
  } else if (manifestChanged) {
    action = "updated";
  }
  return {
    action,
    binDir,
    cliPath,
    serverPath,
    manifestPath,
    version
  };
}

// packages/cli/src/index.ts
var usage = `Usage: locus-memory <command>

Commands:
  locus-memory mcp              Start the Locus MCP server
  locus-memory context          Print zero-call session/prompt memory brief
  locus-memory sync-runtime     Install local runtime binaries to ~/.locus/bin
  locus-memory install codex    Install Locus for Codex
  locus-memory doctor codex     Diagnose the Codex installation
  locus-memory hook codex       Run a Codex lifecycle hook
  locus-memory uninstall codex  Remove Locus from Codex config

Options:
  --help, help     Show this help
  --version        Show package version`;
var contextUsage = `Usage: locus-memory context [--mode session-start|prompt] [--prompt <text>] [--cwd <path>] [--max-tokens <n>] [--json]

Outputs a bounded zero-call project memory brief for session start or prompt recall.`;
var syncRuntimeUsage = `Usage: locus-memory sync-runtime [--json]

Installs local cli.js and server.js runtime binaries into ~/.locus/bin (or $LOCUS_HOME/bin).`;
var installCodexUsage = `Usage: locus-memory install codex [--dry-run] [--with-hooks]

Installs Locus into Codex by configuring the package-owned MCP server and skill.

Options:
  --dry-run        Show planned changes without writing files
  --with-hooks     Also install optional Codex lifecycle hooks
  --yes            Accepted for backwards compatibility`;
var uninstallCodexUsage = `Usage: locus-memory uninstall codex --yes

Removes the package-owned Codex MCP entry while preserving skills and memory data.

Options:
  --yes            Confirm removal`;
function readFlagValue(args, flagName) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === flagName) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }
  return void 0;
}
async function runCli(argv = process.argv.slice(2), io = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
}, options = {}) {
  const [command, subcommand] = argv;
  if (!command || command === "--help" || command === "help") {
    io.stdout(usage);
    return 0;
  }
  if (command === "--version" || command === "version") {
    io.stdout(resolvePackageVersion(options.startDir));
    return 0;
  }
  if (command === "mcp") {
    return runMcp();
  }
  if (command === "context") {
    if (argv.includes("--help")) {
      io.stdout(contextUsage);
      return 0;
    }
    const rawMaxTokens = readFlagValue(argv, "--max-tokens");
    let maxTokens;
    if (rawMaxTokens !== void 0) {
      const parsed = Number(rawMaxTokens);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        io.stderr("Option --max-tokens must be a positive integer.");
        return 1;
      }
      maxTokens = parsed;
    }
    const result = await runContextCommand({
      mode: readFlagValue(argv, "--mode"),
      prompt: readFlagValue(argv, "--prompt"),
      cwd: readFlagValue(argv, "--cwd"),
      json: argv.includes("--json"),
      maxTokens,
      env: options.env
    });
    if (result.stdout) {
      io.stdout(result.stdout);
    }
    if (result.stderr) {
      io.stderr(result.stderr);
    }
    return result.exitCode;
  }
  if (command === "sync-runtime") {
    if (argv.includes("--help")) {
      io.stdout(syncRuntimeUsage);
      return 0;
    }
    try {
      const result = installLocalCliRuntime({
        env: options.env,
        startDir: options.startDir,
        sourceDistDir: options.sourceDistDir
      });
      if (argv.includes("--json")) {
        io.stdout(JSON.stringify(result));
      } else {
        io.stdout(`Locus local runtime ${result.action} (${result.version}) at ${result.binDir}`);
      }
      return 0;
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  if (command === "hook" && subcommand === "codex") {
    const result = runCodexHook({
      event: argv[2],
      stdin: options.stdin,
      env: options.env
    });
    if (result.stdout) {
      io.stdout(result.stdout);
    }
    if (result.stderr) {
      io.stderr(result.stderr);
    }
    return result.exitCode;
  }
  if (command === "install" && subcommand === "codex" && argv.includes("--help")) {
    io.stdout(installCodexUsage);
    return 0;
  }
  if (command === "install" && subcommand === "codex" && argv.includes("--dry-run")) {
    io.stdout(
      formatInstallCodexDryRun({
        env: options.env,
        startDir: options.startDir,
        withHooks: argv.includes("--with-hooks")
      })
    );
    return 0;
  }
  if (command === "install" && subcommand === "codex") {
    const result = await runInstallCodex({
      env: options.env,
      startDir: options.startDir,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      platform: options.platform,
      withHooks: argv.includes("--with-hooks")
    });
    io.stdout(result.output);
    return result.exitCode;
  }
  if (command === "doctor" && subcommand === "codex") {
    io.stdout(
      await formatDoctorCodex({
        env: options.env,
        startDir: options.startDir,
        commandRunner: options.commandRunner ?? defaultCommandRunner,
        readMcpServer: options.readMcpServer
      })
    );
    return 0;
  }
  if (command === "uninstall" && subcommand === "codex" && argv.includes("--help")) {
    io.stdout(uninstallCodexUsage);
    return 0;
  }
  if (command === "uninstall" && subcommand === "codex" && argv.includes("--yes")) {
    const result = await runUninstallCodex({
      env: options.env,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      readMcpServer: options.readMcpServer
    });
    io.stdout(result.output);
    return result.exitCode;
  }
  if (command === "uninstall" && subcommand === "codex") {
    io.stderr(uninstallCodexUsage);
    return 1;
  }
  io.stderr(`Unknown command: ${argv.join(" ")}`);
  io.stderr(usage);
  return 1;
}
var isDirectRun = process.argv[1] === fileURLToPath7(import.meta.url);
if (isDirectRun) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
export {
  runCli
};
//# sourceMappingURL=cli.js.map
