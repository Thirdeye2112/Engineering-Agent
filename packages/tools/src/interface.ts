export type ToolPermission = 'read' | 'write' | 'admin';

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

  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  validate(input: unknown): ValidationResult;
}
