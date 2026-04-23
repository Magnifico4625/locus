export type { ClientEnv, ClientRuntime, ClientSurface } from './detect-client.js';
export { detectClientEnv, detectClientRuntime } from './detect-client.js';
export { normalizePathForIdentity } from './normalize-path.js';
export {
  resolveStorageRoot,
  resolveProjectStorageDir,
  resolveDbPath,
  resolveInboxDir,
  resolveLogPath,
} from './resolve-storage.js';
export { projectHash } from './project-hash.js';
