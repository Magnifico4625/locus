#!/usr/bin/env node

// packages/cli/src/index.ts
import { fileURLToPath as fileURLToPath2 } from "node:url";

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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
function findPackageRoot(startDir = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve2(startDir);
  while (true) {
    const packagePath = resolve2(current, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
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
    readFileSync(resolve2(root, "package.json"), "utf8")
  );
  if (!packageJson.version) {
    throw new Error("Root package.json is missing version");
  }
  return packageJson.version;
}
function buildRuntimePackageSpecifier(version) {
  return `locus-memory@${version}`;
}

// packages/cli/src/commands/install-codex.ts
function formatInstallCodexDryRun(options = {}) {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const skillPath = resolveCodexSkillPath(env, "locus-memory");
  const runtimeSpecifier = buildRuntimePackageSpecifier(resolvePackageVersion(options.startDir));
  return [
    "Locus Codex install dry-run",
    `Codex home: ${codexHome}`,
    `Skill path: ${skillPath}`,
    `MCP runtime: npx -y ${runtimeSpecifier} mcp`,
    "Default env: LOCUS_CODEX_CAPTURE=redacted LOCUS_CAPTURE_LEVEL=redacted LOCUS_LOG=error"
  ].join("\n");
}

// packages/cli/src/commands/mcp.ts
async function runMcp() {
  await import(new URL("./server.js", import.meta.url).href);
  return 0;
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
  if ((command === "install" || command === "doctor" || command === "uninstall") && subcommand === "codex") {
    io.stderr(`${command} codex: ${notImplemented}`);
    return 1;
  }
  io.stderr(`Unknown command: ${argv.join(" ")}`);
  io.stderr(usage);
  return 1;
}
var isDirectRun = process.argv[1] === fileURLToPath2(import.meta.url);
if (isDirectRun) {
  const exitCode = await runCli();
  process.exitCode = exitCode;
}
export {
  runCli
};
//# sourceMappingURL=cli.js.map
