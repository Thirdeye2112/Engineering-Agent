import { spawn } from 'child_process';
import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission } from './interface.js';

export interface TerminalInput {
  command: string;
  args?: string[];
  cwd?: string;
}

const DEFAULT_ALLOWLIST = ['git', 'npm', 'pnpm', 'node', 'tsc', 'eslint', 'tsx'];

export class TerminalTool implements ITool {
  readonly name = 'terminal';
  readonly description = `Run permitted commands. Allowed: ${DEFAULT_ALLOWLIST.join(', ')}. Uses spawn (no shell injection).`;
  readonly permissions: ToolPermission[] = ['write'];

  private allowlist: string[];
  private timeoutMs: number;

  constructor(options?: { allowlist?: string[]; timeoutMs?: number }) {
    this.allowlist = options?.allowlist ?? DEFAULT_ALLOWLIST;
    this.timeoutMs = options?.timeoutMs ?? parseInt(process.env.TERMINAL_TIMEOUT_MS ?? '30000', 10);
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, error: 'Input must be an object' };
    const i = input as Record<string, unknown>;
    if (typeof i.command !== 'string' || !i.command) return { valid: false, error: 'command must be a non-empty string' };
    if (!this.allowlist.includes(i.command)) {
      return { valid: false, error: `command '${i.command}' not in allowlist: ${this.allowlist.join(', ')}` };
    }
    if (i.args !== undefined && !Array.isArray(i.args)) return { valid: false, error: 'args must be an array' };
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    if (context.permissionLevel === 'read') {
      return { success: false, output: null, error: 'write permission required for terminal', metadata: { durationMs: 0 } };
    }

    const { command, args = [], cwd } = input as TerminalInput;
    const start = Date.now();

    await context.auditLog('terminal.execute', { command, args, cwd, projectId: context.projectId });

    return new Promise(resolve => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      // spawn — never exec, no shell interpolation
      const proc = spawn(command, args, { cwd, shell: false });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: { stdout: stdout.join(''), stderr: stderr.join('') },
          error: `Timeout after ${this.timeoutMs}ms`,
          metadata: { durationMs: Date.now() - start },
        });
      }, this.timeoutMs);

      proc.stdout.on('data', (d: Buffer) => stdout.push(d.toString()));
      proc.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          output: { stdout: stdout.join(''), stderr: stderr.join(''), exitCode: code },
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
          metadata: { durationMs: Date.now() - start },
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, output: null, error: err.message, metadata: { durationMs: Date.now() - start } });
      });
    });
  }
}
