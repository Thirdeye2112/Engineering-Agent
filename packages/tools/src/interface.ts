export type ToolPermission = 'read' | 'write' | 'admin';

/** Gate policy for each tool operation.
 *  auto_allow       — no human approval needed (reads, metadata)
 *  approval_required — block until a human approves the permissionRequest
 *  always_deny      — hard reject regardless of rules (push to main, deploys)
 */
export type GateType = 'auto_allow' | 'approval_required' | 'always_deny';

export interface ToolContext {
  agentId: string;
  projectId: string;
  permissionLevel: ToolPermission;
  auditLog: (action: string, detail: unknown) => Promise<void>;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  /** Set when approval_required and no approval exists yet */
  pendingApproval?: boolean;
  requestId?: string;
  metadata: {
    durationMs: number;
    bytesRead?: number;
    bytesWritten?: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly permissions: ToolPermission[];
  /** Per-operation gate policy. Missing operation defaults to approval_required. */
  readonly gates: Record<string, GateType>;

  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  validate(input: unknown): ValidationResult;
}
