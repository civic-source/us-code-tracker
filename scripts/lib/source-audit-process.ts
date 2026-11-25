import { execFile } from 'node:child_process';

export interface AuditCommand { code: number | null; stdout: Buffer; stderr: Buffer; error?: string }

/** Child failures retain bounded diagnostics and cannot become a successful witness. */
export function auditCommand(file: string, args: string[], options: { maxBuffer?: number; timeout?: number } = {}): Promise<AuditCommand> {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: options.maxBuffer ?? 2 * 1024 ** 2,
      timeout: options.timeout ?? 120_000 }, (error, stdout, stderr) => {
      const code = error ? typeof error.code === 'number' ? error.code : null : 0;
      resolve({ code, stdout, stderr, ...(error ? { error: error.message } : {}) });
    });
  });
}
