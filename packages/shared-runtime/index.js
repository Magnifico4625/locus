// @locus/shared-runtime — path resolution + client detection
// Plain ESM JS. Only node:os, node:path, node:crypto, node:url, process.env. No build step.
export { detectClientEnv, detectClientRuntime } from './detect-client.js';
export { normalizePathForIdentity } from './normalize-path.js';
export { projectHash } from './project-hash.js';
export {
  resolveDbPath,
  resolveInboxDir,
  resolveLocusHome,
  resolveLogPath,
  resolveProjectStorageDir,
  resolveRuntimeBinDir,
  resolveStorageRoot,
} from './resolve-storage.js';
