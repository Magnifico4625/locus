import type { DoctorReport } from '../types.js';
export async function handleDoctor(): Promise<DoctorReport> {
  return { checks: [], passed: 0, warnings: 0, failures: 0 };
}
