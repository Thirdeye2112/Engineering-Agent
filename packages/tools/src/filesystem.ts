import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, statSync, realpathSync } from 'fs';
import { resolve, normalize, relative } from 'path';
import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission, GateType } from './interface.js';

type Operation = 'read_file' | 'write_file' | 'list_dir' | 'create_dir' | 'delete_file';

export interface FilesystemInput {
  operation: Operation;
  path: string;
  content?: string;
}

export class FilesystemTool implements ITool {
  readonly name = 'filesystem';
  readonly description = 'Read and write files within the project sandbox. Operations: read_file, write_file, list_dir, create_dir, delete_file.';
  readonly permissions: ToolPermission[] = ['read', 'write'];
  readonly gates: Record<string, GateType> = {
    read_file:   'auto_allow',
    list_dir:    'auto_allow',
    write_file:  'approval_required',
    create_dir:  'approval_required',
    delete_file: 'approval_required',
  };

  constructor(private sandboxRoot: string) {
    this.sandboxRoot = resolve(sandboxRoot);
  }

  private safePath(inputPath: string): string {
    const abs = resolve(this.sandboxRoot, inputPath);
    const rel = relative(this.sandboxRoot, abs);
    if (rel.startsWith('..') || normalize(rel) === '..') {
      throw new Error(`Path traversal rejected: ${inputPath}`);
    }
    // Resolve symlinks to their real path and re-check sandbox boundary.
    // This prevents symlink escape attacks (e.g. a symlink inside the sandbox
    // pointing to /etc/passwd would pass the first check but fail this one).
    try {
      const real = realpathSync(abs);
      const realRel = relative(this.sandboxRoot, real);
      if (realRel.startsWith('..') || normalize(realRel) === '..') {
        throw new Error(`Symlink escape rejected: ${inputPath} resolves outside sandbox`);
      }
    } catch (err) {
      // If the path doesn't exist yet (write_file to new file), realpathSync throws.
      // Only propagate if it's our sandbox violation error.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return abs;
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, error: 'Input must be an object' };
    }
    const i = input as Record<string, unknown>;
    const ops: Operation[] = ['read_file', 'write_file', 'list_dir', 'create_dir', 'delete_file'];
    if (!ops.includes(i.operation as Operation)) {
      return { valid: false, error: `operation must be one of: ${ops.join(', ')}` };
    }
    if (typeof i.path !== 'string' || !i.path) {
      return { valid: false, error: 'path must be a non-empty string' };
    }
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    const { operation, path: inputPath, content } = input as FilesystemInput;
    const start = Date.now();

    try {
      const safePath = this.safePath(inputPath);

      if (['write_file', 'create_dir', 'delete_file'].includes(operation) && context.permissionLevel === 'read') {
        return { success: false, output: null, error: 'write permission required', metadata: { durationMs: 0 } };
      }

      let output: unknown;
      let bytesRead: number | undefined;
      let bytesWritten: number | undefined;

      switch (operation) {
        case 'read_file': {
          const data = readFileSync(safePath, 'utf-8');
          bytesRead = Buffer.byteLength(data);
          output = data;
          break;
        }
        case 'write_file': {
          const data = content ?? '';
          writeFileSync(safePath, data, 'utf-8');
          bytesWritten = Buffer.byteLength(data);
          output = { written: bytesWritten };
          break;
        }
        case 'list_dir': {
          const entries = readdirSync(safePath, { withFileTypes: true });
          output = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
          break;
        }
        case 'create_dir': {
          mkdirSync(safePath, { recursive: true });
          output = { created: safePath };
          break;
        }
        case 'delete_file': {
          statSync(safePath); // throws if not found
          unlinkSync(safePath);
          output = { deleted: inputPath };
          break;
        }
      }

      await context.auditLog(`filesystem.${operation}`, { path: inputPath, projectId: context.projectId });
      return { success: true, output, metadata: { durationMs: Date.now() - start, bytesRead, bytesWritten } };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message, metadata: { durationMs: Date.now() - start } };
    }
  }
}
