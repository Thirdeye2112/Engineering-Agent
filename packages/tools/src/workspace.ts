import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, normalize, relative } from 'node:path';
import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission, GateType } from './interface.js';
import { redact, summarise } from '@consensus/secrets';

export type WorkspaceOperation = 'list_files' | 'read_file' | 'propose_write' | 'apply_write';

export interface WorkspaceInput {
  operation: WorkspaceOperation;
  path?: string;
  content?: string;
  proposalId?: string;
}

// In-process pending write store: proposalId → { path, content, approved }
// For production this should be DB-backed; for Phase 2 in-process is sufficient
// since the agent and server share the same process.
const pendingWrites = new Map<string, { path: string; content: string; approved: boolean }>();

const VALID_OPS: WorkspaceOperation[] = ['list_files', 'read_file', 'propose_write', 'apply_write'];

export class WorkspaceTool implements ITool {
  readonly name = 'workspace';
  readonly description = 'Read workspace files and propose writes for human approval. Sandboxed to workspace root.';
  readonly permissions: ToolPermission[] = ['read', 'write'];
  readonly gates: Record<string, GateType> = {
    list_files:    'auto_allow',
    read_file:     'auto_allow',
    propose_write: 'approval_required',
    apply_write:   'approval_required',
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
    // Resolve symlinks to prevent symlink-escape attacks
    try {
      const real = realpathSync(abs);
      const realRel = relative(this.sandboxRoot, real);
      if (realRel.startsWith('..') || normalize(realRel) === '..') {
        throw new Error(`Symlink escape rejected: ${inputPath} resolves outside workspace`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return abs;
  }

  private checkSecrets(content: string): void {
    const redacted = redact(content);
    if (redacted !== content) {
      throw new Error('Write blocked: content contains detected secret patterns. Remove secrets before proposing a write.');
    }
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, error: 'Input must be an object' };
    const i = input as Record<string, unknown>;
    if (!VALID_OPS.includes(i.operation as WorkspaceOperation))
      return { valid: false, error: `operation must be one of: ${VALID_OPS.join(', ')}` };
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    const inp = input as WorkspaceInput;
    const start = Date.now();

    try {
      let output: unknown;

      switch (inp.operation) {
        case 'list_files': {
          const path = inp.path ?? '';
          const safe = this.safePath(path);
          const entries = readdirSync(safe, { withFileTypes: true });
          output = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
          break;
        }

        case 'read_file': {
          if (!inp.path) return { success: false, output: null, error: 'path is required', metadata: { durationMs: 0 } };
          const safe = this.safePath(inp.path);
          const raw = readFileSync(safe, 'utf-8');
          // Redact secrets before returning to agent's conversation thread
          output = { path: inp.path, content: redact(raw) };
          break;
        }

        case 'propose_write': {
          if (!inp.path) return { success: false, output: null, error: 'path is required', metadata: { durationMs: 0 } };
          if (inp.content === undefined) return { success: false, output: null, error: 'content is required', metadata: { durationMs: 0 } };
          this.safePath(inp.path);   // validate path before storing proposal
          this.checkSecrets(inp.content);

          const proposalId = `wp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          pendingWrites.set(proposalId, { path: inp.path, content: inp.content, approved: false });

          output = {
            proposalId,
            path: inp.path,
            contentSummary: summarise(inp.content, 200),
            status: 'pending_approval',
            message: 'Write proposed. A human must approve this proposal before apply_write can execute it.',
          };
          break;
        }

        case 'apply_write': {
          if (!inp.proposalId) return { success: false, output: null, error: 'proposalId is required', metadata: { durationMs: 0 } };
          const proposal = pendingWrites.get(inp.proposalId);
          if (!proposal) return { success: false, output: null, error: `Unknown proposalId: ${inp.proposalId}`, metadata: { durationMs: 0 } };
          if (!proposal.approved) {
            return { success: false, output: null, error: `Proposal ${inp.proposalId} has not been approved yet.`, metadata: { durationMs: 0 } };
          }
          const safe = this.safePath(proposal.path);
          writeFileSync(safe, proposal.content, 'utf-8');
          pendingWrites.delete(inp.proposalId);
          output = { applied: true, path: proposal.path, bytesWritten: Buffer.byteLength(proposal.content) };
          break;
        }
      }

      await context.auditLog(`workspace.${inp.operation}`, {
        path: inp.path, proposalId: inp.proposalId, projectId: context.projectId,
      });
      return { success: true, output, metadata: { durationMs: Date.now() - start } };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message, metadata: { durationMs: Date.now() - start } };
    }
  }

  /** Called by the approval flow to mark a proposal as approved. */
  approveProposal(proposalId: string): boolean {
    const p = pendingWrites.get(proposalId);
    if (!p) return false;
    p.approved = true;
    return true;
  }
}
