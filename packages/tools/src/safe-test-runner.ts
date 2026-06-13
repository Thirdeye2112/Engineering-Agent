import { spawn } from 'child_process';
import { resolve, relative, normalize } from 'path';
import { existsSync } from 'fs';
import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission, GateType } from './interface.js';
import { redact } from '@consensus/secrets';

// ── Test profile types ────────────────────────────────────────────────────────

export type TestProfile = 'unit' | 'lint' | 'typecheck' | 'targeted';

export interface TestCommand {
  command: string;
  args: string[];
  /** Human-readable label */
  label: string;
}

export interface TestProfileConfig {
  unit?: TestCommand;
  lint?: TestCommand;
  typecheck?: TestCommand;
  targeted?: TestCommand;
}

// ── Blocked pattern detection ─────────────────────────────────────────────────

// Patterns that indicate chaining or injection attempts in any argument
const BLOCKED_ARG_PATTERNS = [
  /&&/,
  /\|\|/,
  /;/,
  /`/,
  /\$\(/,
  />/,
  /</,
  /\|/,
];

// Commands that must never be executed regardless of allowlist
const HARD_BLOCKED_COMMANDS = new Set([
  'curl', 'wget', 'rm', 'del', 'rmdir',
  'git',            // blocks git push, git reset, etc.
  'docker', 'kubectl',
  'deploy', 'ansible', 'terraform',
  'npm-install', 'yarn', 'pip', 'pip3',
  'bash', 'sh', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd',
  'eval', 'exec',
]);

// Allowed base commands (must match exactly)
const ALLOWED_COMMANDS = new Set([
  'npm', 'pnpm', 'node', 'npx', 'tsc', 'eslint', 'jest',
  'vitest', 'mocha', 'tsx', 'ts-node',
]);

// Allowed npm/pnpm subcommand patterns for the first arg
const ALLOWED_NPM_ARGS = /^(test|run|exec)$/;
const ALLOWED_NPM_RUN_SCRIPTS = /^(test|lint|typecheck|build|check|validate|format:check|test:\w+)$/;

// ── Default profiles ──────────────────────────────────────────────────────────

const DEFAULT_PROFILES: TestProfileConfig = {
  unit:      { command: 'pnpm', args: ['test'],      label: 'pnpm test' },
  lint:      { command: 'pnpm', args: ['lint'],      label: 'pnpm lint' },
  typecheck: { command: 'pnpm', args: ['typecheck'], label: 'pnpm typecheck' },
};

const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

export interface SafeTestRunnerInput {
  profile: TestProfile;
  /** For 'targeted': which test file or pattern to run */
  targetPattern?: string;
  workingDirectory?: string;
}

export class SafeTestRunner implements ITool {
  readonly name = 'safe_test_runner';
  readonly description = 'Run predefined project test commands (unit/lint/typecheck/targeted). Cannot run arbitrary shell commands.';
  readonly permissions: ToolPermission[] = ['read'];
  readonly gates: Record<string, GateType> = {
    run: 'approval_required',
  };

  private profiles: TestProfileConfig;
  private sandboxRoot: string;
  private timeoutMs: number;

  constructor(options?: {
    profiles?: TestProfileConfig;
    sandboxRoot?: string;
    timeoutMs?: number;
  }) {
    this.profiles = { ...DEFAULT_PROFILES, ...options?.profiles };
    this.sandboxRoot = resolve(options?.sandboxRoot ?? process.env.FILESYSTEM_SANDBOX_ROOT ?? '.');
    this.timeoutMs = options?.timeoutMs ?? parseInt(process.env.TEST_TIMEOUT_MS ?? '120000', 10);
  }

  /** Validate that a command + args are safe to execute. */
  private isSafeCommand(command: string, args: string[]): { safe: boolean; reason?: string } {
    const cmd = command.toLowerCase();

    if (HARD_BLOCKED_COMMANDS.has(cmd)) {
      return { safe: false, reason: `Command '${command}' is hard-blocked.` };
    }
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return { safe: false, reason: `Command '${command}' is not in the allowed-command set.` };
    }

    for (const arg of args) {
      for (const pattern of BLOCKED_ARG_PATTERNS) {
        if (pattern.test(arg)) {
          return { safe: false, reason: `Argument '${arg}' contains a blocked pattern (${pattern}).` };
        }
      }
    }

    // npm/pnpm: first arg must be 'test', 'run', or 'exec'
    if ((cmd === 'npm' || cmd === 'pnpm') && args.length > 0) {
      if (!ALLOWED_NPM_ARGS.test(args[0])) {
        return { safe: false, reason: `${cmd} subcommand '${args[0]}' is not allowed. Only: test, run, exec.` };
      }
      // npm run / pnpm run: second arg is the script name
      if (args[0] === 'run' && args[1] && !ALLOWED_NPM_RUN_SCRIPTS.test(args[1])) {
        return { safe: false, reason: `Script '${args[1]}' is not in the allowed-script set.` };
      }
    }

    return { safe: true };
  }

  private safeCwd(inputCwd: string | undefined): string {
    if (!inputCwd) return this.sandboxRoot;
    const abs = resolve(this.sandboxRoot, inputCwd);
    const rel = relative(this.sandboxRoot, abs);
    if (rel.startsWith('..') || normalize(rel) === '..') {
      throw new Error(`Working directory traversal rejected: ${inputCwd}`);
    }
    return abs;
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, error: 'Input must be an object' };
    const i = input as Record<string, unknown>;
    const validProfiles: TestProfile[] = ['unit', 'lint', 'typecheck', 'targeted'];
    if (!validProfiles.includes(i.profile as TestProfile)) {
      return { valid: false, error: `profile must be one of: ${validProfiles.join(', ')}` };
    }
    if (i.profile === 'targeted' && typeof i.targetPattern !== 'string') {
      return { valid: false, error: 'targetPattern (string) is required for targeted profile' };
    }
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    const inp = input as SafeTestRunnerInput;
    const start = Date.now();

    // Resolve profile → command
    let profileCmd = this.profiles[inp.profile];

    if (inp.profile === 'targeted') {
      if (!profileCmd) {
        // Default targeted: pnpm test with pattern arg
        profileCmd = {
          command: 'pnpm',
          args: ['test', inp.targetPattern!],
          label: `pnpm test ${inp.targetPattern}`,
        };
      } else if (inp.targetPattern) {
        profileCmd = {
          ...profileCmd,
          args: [...profileCmd.args, inp.targetPattern],
          label: `${profileCmd.label} ${inp.targetPattern}`,
        };
      }
    }

    if (!profileCmd) {
      return {
        success: false,
        output: { status: 'tests_not_configured', profile: inp.profile },
        error: `No test command configured for profile '${inp.profile}'.`,
        metadata: { durationMs: Date.now() - start },
      };
    }

    // Safety validation on the resolved command
    const safeCheck = this.isSafeCommand(profileCmd.command, profileCmd.args);
    if (!safeCheck.safe) {
      await context.auditLog('test.blocked', {
        profile: inp.profile,
        command: profileCmd.command,
        args: profileCmd.args,
        reason: safeCheck.reason,
        projectId: context.projectId,
      });
      return {
        success: false,
        output: null,
        error: `Test blocked: ${safeCheck.reason}`,
        metadata: { durationMs: Date.now() - start },
      };
    }

    // Resolve working directory
    let cwd: string;
    try {
      cwd = this.safeCwd(inp.workingDirectory);
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message, metadata: { durationMs: Date.now() - start } };
    }

    if (!existsSync(cwd)) {
      return {
        success: false,
        output: { status: 'tests_not_configured', profile: inp.profile },
        error: `Working directory does not exist: ${cwd}`,
        metadata: { durationMs: Date.now() - start },
      };
    }

    await context.auditLog('test.requested', {
      profile: inp.profile,
      command: profileCmd.command,
      args: profileCmd.args,
      cwd,
      projectId: context.projectId,
    });

    return new Promise(resolve => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let truncated = false;

      const proc = spawn(profileCmd!.command, profileCmd!.args, {
        cwd,
        shell: false,
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        const elapsed = Date.now() - start;
        const stdout = redact(Buffer.concat(stdoutChunks).toString('utf-8'));
        const stderr = redact(Buffer.concat(stderrChunks).toString('utf-8'));
        context.auditLog('test.failed', {
          profile: inp.profile,
          reason: 'timeout',
          durationMs: elapsed,
          projectId: context.projectId,
        }).catch(() => {});
        resolve({
          success: false,
          output: { stdout, stderr, exitCode: null, truncated, status: 'timeout', profile: inp.profile },
          error: `Test timed out after ${this.timeoutMs}ms`,
          metadata: { durationMs: elapsed },
        });
      }, this.timeoutMs);

      const onData = (chunks: Buffer[], buf: Buffer) => {
        if (truncated) return;
        const remaining = MAX_OUTPUT_BYTES - totalBytes;
        if (buf.length > remaining) {
          chunks.push(buf.subarray(0, remaining));
          totalBytes += remaining;
          truncated = true;
        } else {
          chunks.push(buf);
          totalBytes += buf.length;
        }
      };

      proc.stdout.on('data', (d: Buffer) => onData(stdoutChunks, d));
      proc.stderr.on('data', (d: Buffer) => onData(stderrChunks, d));

      proc.on('close', async (code) => {
        clearTimeout(timer);
        const elapsed = Date.now() - start;
        const stdout = redact(Buffer.concat(stdoutChunks).toString('utf-8'));
        const stderr = redact(Buffer.concat(stderrChunks).toString('utf-8'));
        const succeeded = code === 0;

        await context.auditLog(succeeded ? 'test.executed' : 'test.failed', {
          profile: inp.profile,
          exitCode: code,
          durationMs: elapsed,
          truncated,
          projectId: context.projectId,
        }).catch(() => {});

        resolve({
          success: succeeded,
          output: {
            stdout,
            stderr,
            exitCode: code,
            truncated,
            status: succeeded ? 'passed' : 'failed',
            profile: inp.profile,
            label: profileCmd!.label,
          },
          error: succeeded ? undefined : `Tests failed with exit code ${code}`,
          metadata: { durationMs: elapsed },
        });
      });

      proc.on('error', async (err) => {
        clearTimeout(timer);
        const elapsed = Date.now() - start;
        await context.auditLog('test.failed', {
          profile: inp.profile,
          reason: err.message,
          durationMs: elapsed,
          projectId: context.projectId,
        }).catch(() => {});
        resolve({
          success: false,
          output: null,
          error: err.message,
          metadata: { durationMs: elapsed },
        });
      });
    });
  }
}
