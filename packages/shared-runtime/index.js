// @locus/shared-runtime — path resolution + client detection
// Plain ESM JS. Only node:os, node:path, node:crypto, process.env. No build step.
export { detectClientEnv } from './detect-client.js';
export { projectHash } from './project-hash.js';
export {
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
  resolveProjectStorageDir,
  resolveStorageRoot,
} from './resolve-storage.js';
