export type { ClientEnv, ClientRuntime, ClientSurface } from './detect-client.js';
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
