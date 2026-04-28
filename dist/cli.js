#!/usr/bin/env node

// packages/cli/src/index.ts
import { fileURLToPath as fileURLToPath5 } from "node:url";

// packages/cli/src/codex/config.ts
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
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
  if (command === "node" && /dist[\\/]+server\.js/i.test(joinedArgs)) {
    return "manual-locus";
  }
  return "foreign-locus";
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
  const text = readFileSync(configPath, "utf8");
  const headerPattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\s*$`, "m");
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
  writeFileSync(configPath, `${before}${updatedSection}${after}`, "utf8");
  return { action: "updated", backupPath };
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function timestamp(date) {
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".", "");
}

// packages/cli/src/codex/paths.ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function resolveCodexHome(env = process.env) {
  const configured = env.CODEX_HOME;
  if (configured && configured.trim().length > 0) {
    return resolve(expandTilde(configured));
  }
  return join(homedir(), ".codex");
}
function resolveCodexConfigPath(env = process.env) {
  return join(resolveCodexHome(env), "config.toml");
}
function resolveCodexSkillPath(env = process.env, skillName = "locus-memory") {
  return join(resolveCodexHome(env), "skills", skillName, "SKILL.md");
}
function expandTilde(pathValue) {
  if (pathValue === "~") {
    return homedir();
  }
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

// packages/cli/src/package-info.ts
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
function findPackageRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve2(startDir);
  while (true) {
    const packagePath = resolve2(current, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync2(packagePath, "utf8"));
      if (packageJson.name === "locus-memory") {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find locus-memory package root from ${startDir}`);
    }
    current = parent;
  }
}
function resolvePackageVersion(startDir) {
  const root = findPackageRoot(startDir);
  const packageJson = JSON.parse(
    readFileSync2(resolve2(root, "package.json"), "utf8")
  );
  if (!packageJson.version) {
    throw new Error("Root package.json is missing version");
  }
  return packageJson.version;
}
function buildRuntimePackageSpecifier(version) {
  return `locus-memory@${version}`;
}

// packages/cli/src/commands/doctor-codex.ts
async function formatDoctorCodex(options) {
  const env = options.env ?? process.env;
  const version = resolvePackageVersion(options.startDir);
  const codexVersion = await options.commandRunner("codex", ["--version"]);
  const ownership = classifyMcpOwnership(options.readMcpServer?.());
  return [
    "Locus Codex doctor",
    `Node version: ${process.version}`,
    `Codex version: ${codexVersion.exitCode === 0 ? codexVersion.stdout.trim() : "unavailable"}`,
    `Codex home: ${resolveCodexHome(env)}`,
    `Codex config: ${resolveCodexConfigPath(env)}`,
    `Skill path: ${resolveCodexSkillPath(env, "locus-memory")}`,
    `Runtime package: ${buildRuntimePackageSpecifier(version)}`,
    "Cache warming: not attempted by doctor",
    "Network: first run after cache cleanup requires network access",
    `Ownership: ${ownership}`
  ].join("\n");
}

// packages/cli/src/commands/install-codex.ts
import { existsSync as existsSync8 } from "node:fs";
import { join as join9 } from "node:path";

// packages/cli/src/codex/cleanup.ts
import { existsSync as existsSync2, readdirSync, rmSync, statSync } from "node:fs";
import { join as join2 } from "node:path";
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
  const skillDir = join2(codexHome, "skills", "locus-memory");
  const tempFiles = [];
  if (!existsSync2(skillDir)) {
    return tempFiles;
  }
  for (const entry of readdirSync(skillDir)) {
    if (!entry.endsWith(".locus-tmp")) {
      continue;
    }
    const path = join2(skillDir, entry);
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
function buildCodexMcpAddArgs(options) {
  const env = options.env ?? defaultCodexMcpEnv;
  const args = ["mcp", "add"];
  for (const [key, value] of Object.entries(env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(
    options.name,
    "--",
    detectNpxCommand(options.platform),
    "-y",
    `locus-memory@${options.version}`,
    "mcp"
  );
  return args;
}
function buildCodexMcpRemoveArgs(name) {
  return ["mcp", "remove", name];
}

// packages/cli/src/codex/lock.ts
import { existsSync as existsSync3, mkdirSync, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var defaultStaleAfterMs = 15 * 60 * 1e3;
function acquireInstallLock(codexHome, options = {}) {
  mkdirSync(codexHome, { recursive: true });
  const lockPath = join3(codexHome, ".locus-install.lock");
  if (existsSync3(lockPath)) {
    const stale = isStaleLock(lockPath, options);
    return {
      acquired: false,
      path: lockPath,
      reason: stale ? "stale" : "active",
      message: stale ? `Stale Locus install lock found at ${lockPath}. Remove it after confirming no installer is running.` : `Another Locus installer is already running: ${lockPath}`
    };
  }
  try {
    writeFileSync2(
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
    const lock = JSON.parse(readFileSync3(lockPath, "utf8"));
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
  copyFileSync as copyFileSync4,
  existsSync as existsSync7,
  mkdirSync as mkdirSync5,
  readFileSync as readFileSync7,
  renameSync as renameSync2,
  writeFileSync as writeFileSync5
} from "node:fs";
import { dirname as dirname4 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// packages/codex/src/ids.ts
import { createHash } from "node:crypto";
import { basename } from "node:path";

// packages/codex/src/importer.ts
import { readFileSync as readFileSync4 } from "node:fs";

// packages/codex/src/inbox-writer.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync2, renameSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join4 } from "node:path";

// packages/codex/src/paths.ts
import { homedir as homedir2 } from "node:os";
import { join as join5, resolve as resolve3 } from "node:path";

// packages/codex/src/session-files.ts
import { readdirSync as readdirSync2 } from "node:fs";
import { basename as basename2, join as join6, resolve as resolve4 } from "node:path";

// packages/codex/src/plugin-sync.ts
import { copyFileSync as copyFileSync2, existsSync as existsSync5, mkdirSync as mkdirSync3, readFileSync as readFileSync5, rmSync as rmSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname2, join as join7, resolve as resolve5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// packages/codex/src/skill-sync.ts
import { copyFileSync as copyFileSync3, existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname3, join as join8, resolve as resolve6 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function resolveCanonicalCodexSkillPath() {
  return resolve6(fileURLToPath3(new URL("../skills/locus-memory/SKILL.md", import.meta.url)));
}

// packages/cli/src/codex/skill.ts
function installCodexSkill(options = {}) {
  const sourcePath = options.sourcePath ?? resolvePackagedCodexSkillPath();
  const targetPath = resolveCodexSkillPath(options.env, "locus-memory");
  const sourceContent = readFileSync7(sourcePath, "utf8");
  try {
    mkdirSync5(dirname4(targetPath), { recursive: true });
    if (existsSync7(targetPath)) {
      const targetContent = readFileSync7(targetPath, "utf8");
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
    fileURLToPath4(new URL("../packages/codex/skills/locus-memory/SKILL.md", import.meta.url))
  ];
  for (const candidate of candidates) {
    if (existsSync7(candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? resolveCanonicalCodexSkillPath();
}
function backupSkill(targetPath, now) {
  const backupPath = `${targetPath}.${timestamp2(now)}.bak`;
  copyFileSync4(targetPath, backupPath);
  return {
    action: "backed_up",
    path: backupPath
  };
}
function writeAtomically(targetPath, content, writeFile = writeFileSync5) {
  const tempPath = `${targetPath}.locus-tmp`;
  writeFile(tempPath, content, "utf8");
  renameSync2(tempPath, targetPath);
}
function timestamp2(date) {
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
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));
  const lockPath = join9(codexHome, ".locus-install.lock");
  const tempFiles = findInterruptedInstallTempFiles(codexHome);
  return [
    "Locus Codex install dry-run",
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: npx -y ${runtimeSpecifier} mcp`,
    `MCP cwd: ${codexHome}`,
    "Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error",
    `Install lock: ${existsSync8(lockPath) ? `present at ${lockPath}` : "none"}`,
    `Stale temp files: ${tempFiles.length}`
  ].join("\n");
}
async function runInstallCodex(options) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const version = resolvePackageVersion(options.startDir);
  const runtimeSpecifier = buildRuntimePackageSpecifier(version);
  const lock = acquireInstallLock(codexHome);
  if (!lock.acquired) {
    return {
      exitCode: 1,
      output: lock.message ?? `Could not acquire install lock: ${lock.path}`
    };
  }
  try {
    const cleanup = cleanupInterruptedInstall(codexHome);
    const cacheResult = await options.commandRunner("npm", [
      "exec",
      "-y",
      runtimeSpecifier,
      "--",
      "--help"
    ]);
    if (cacheResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          `Runtime package unavailable: ${runtimeSpecifier}`,
          "No Codex MCP config was changed.",
          "This is expected before the package is published to npm unless it already exists in the npm cache.",
          cacheResult.stderr.trim()
        ].filter(Boolean).join("\n")
      };
    }
    const existing = await options.commandRunner("codex", ["mcp", "get", "locus"]);
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
      const removeResult = await options.commandRunner("codex", ["mcp", "remove", "locus"]);
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
        platform: options.platform
      })
    );
    if (addResult.exitCode !== 0) {
      return {
        exitCode: 1,
        output: [
          "Partial state: no skill was installed because Codex MCP configuration failed.",
          `Remediation: codex mcp add locus -- npx -y ${runtimeSpecifier} mcp`,
          addResult.stderr.trim()
        ].join("\n")
      };
    }
    const cwdResult = setMcpServerCwd(resolveCodexConfigPath(env), "locus", codexHome);
    const skill = installCodexSkill({ env, overwrite: true, backup: true });
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
        skill.error ? `Error: ${skill.error.message}` : void 0
      ].filter((line) => Boolean(line)).join("\n")
    };
  } finally {
    lock.release?.();
  }
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
var defaultCommandRunner = async (command, args) => {
  try {
    const [resolvedCommand, resolvedArgs] = resolveCommandForPlatform(command, args);
    const result = await execFileAsync(resolvedCommand, resolvedArgs, {
      encoding: "utf8",
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
  const config = options.readMcpServer?.() ?? parseCodexMcpGetOutput((await options.commandRunner("codex", ["mcp", "get", "locus"])).stdout);
  const ownership = classifyMcpOwnership(config);
  const lines = [`Ownership: ${ownership}`];
  if (ownership === "package-owned") {
    const result = await options.commandRunner("codex", buildCodexMcpRemoveArgs("locus"));
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
  lines.push(`Skill preserved: ${resolveCodexSkillPath(options.env, "locus-memory")}`);
  lines.push("Memory data untouched.");
  return { exitCode: 0, output: lines.join("\n") };
}

// packages/cli/src/index.ts
var usage = `Usage: locus-memory <command>

Commands:
  locus-memory mcp              Start the Locus MCP server
  locus-memory install codex    Install Locus for Codex
  locus-memory doctor codex     Diagnose the Codex installation
  locus-memory uninstall codex  Remove Locus from Codex config

Options:
  --help, help     Show this help
  --version        Show package version`;
var notImplemented = "This command is not implemented yet in the current Track B task.";
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
  if (command === "install" && subcommand === "codex" && argv.includes("--dry-run")) {
    io.stdout(formatInstallCodexDryRun({ env: options.env, startDir: options.startDir }));
    return 0;
  }
  if (command === "install" && subcommand === "codex" && argv.includes("--yes")) {
    const result = await runInstallCodex({
      env: options.env,
      startDir: options.startDir,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      platform: options.platform
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
  if (command === "uninstall" && subcommand === "codex" && argv.includes("--yes")) {
    const result = await runUninstallCodex({
      env: options.env,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
      readMcpServer: options.readMcpServer
    });
    io.stdout(result.output);
    return result.exitCode;
  }
  if ((command === "install" || command === "doctor" || command === "uninstall") && subcommand === "codex") {
    io.stderr(`${command} codex: ${notImplemented}`);
    return 1;
  }
  io.stderr(`Unknown command: ${argv.join(" ")}`);
  io.stderr(usage);
  return 1;
}
var isDirectRun = process.argv[1] === fileURLToPath5(import.meta.url);
if (isDirectRun) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
export {
  runCli
};
//# sourceMappingURL=cli.js.map
