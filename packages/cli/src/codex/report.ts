export type InstallAction = 'created' | 'updated' | 'unchanged' | 'backed_up' | 'skipped';

export interface InstallOperation {
  action: InstallAction;
  path: string;
  message?: string;
}

export interface PermissionError {
  code: 'permission_denied';
  message: string;
}
