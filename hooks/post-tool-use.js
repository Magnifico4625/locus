// Locus post-tool-use hook
// Captures metadata from tool invocations (metadata-only by default)
// See ARCHITECTURE.md Contract 1 for field specifications

export default async function postToolUse(_event) {
  // TODO: implement hook capture logic
  // 1. Extract toolName, filePaths, status, exitCode, durationMs, diffStats
  // 2. Check captureLevel from config
  // 3. Apply file denylist check
  // 4. Store HookCaptureMetadata to DB
  return undefined;
}
