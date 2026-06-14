import type { IAIProvider } from './provider-interface.js';
import { conversationStore } from './conversation-store.js';
import { buildProposalPrompt, buildCritiquePrompt, buildRevisionPrompt, buildVotePrompt, buildImplementationPrompt, buildToolResultMessage, buildSecurityReviewPrompt } from './prompts.js';
import { AgentProposalSchema, AgentCritiqueSchema, VoteSchema, AgentResponseSchema, SecurityReviewSchema } from '@consensus/shared-types';
import type { AgentRole, AgentProposal, AgentCritique, Vote, AgentResponse, ImplementationStep, SecurityReview } from '@consensus/shared-types';
import { createProvider } from './provider-factory.js';
import type { ITool, ToolContext, ToolResult } from '@consensus/tools';
import { permissionEngine } from '@consensus/permissions';
import { auditLog as globalAuditLog } from '@consensus/audit-log';
import { summarise, redact } from '@consensus/secrets';

export interface AgentConfig {
  provider: IAIProvider;
  role: AgentRole;
  deliberationId: string;
  task: string;
  tools?: ITool[];
  permissionLevel?: 'read' | 'write' | 'admin';
  auditLog?: (action: string, detail: unknown) => Promise<void>;
  /**
   * When > 0, useTool() polls for human approval instead of returning immediately
   * with pendingApproval=true. This enables the agent to resume after a human
   * approves a gate rather than treating the pending state as a hard failure.
   * Set to 0 (default) for fire-and-forget mode (approval must be pre-granted).
   */
  approvalTimeoutMs?: number;
}

function parseJSON<T>(raw: string, label: string): T {
  // Strip markdown code fences
  let cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Find the first JSON object or array start
  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) start = objStart;
  else if (arrStart !== -1) start = arrStart;
  if (start > 0) cleaned = cleaned.slice(start);

  // Try parsing the whole string first (happy path)
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }

  // The response may have trailing text after the JSON. Walk forward from the
  // start trying progressively longer substrings until one parses. This handles
  // cases where the LLM appends prose after the closing brace.
  const opener = cleaned[0];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(0, i + 1)) as T; } catch { /* keep scanning */ }
      }
    }
  }

  throw new Error(`Failed to parse ${label} JSON: ${raw.slice(0, 300)}`);
}

export class Agent {
  private threadId: string;
  private totalCostUsd = 0;

  constructor(private config: AgentConfig) {
    this.threadId = `${config.deliberationId}:${config.role}`;
  }

  async init(): Promise<void> {
    const existing = await conversationStore.getThread(this.threadId);
    if (!existing) {
      await conversationStore.createThread(this.threadId, this.config.role, this.config.deliberationId);
    }
  }

  get costUsd(): number { return this.totalCostUsd; }

  private async call(systemPrompt: string, userMessage: string): Promise<string> {
    const thread = await conversationStore.getThread(this.threadId);
    if (!thread) throw new Error(`Thread ${this.threadId} not found — call init() first`);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...thread.messages,
      { role: 'user' as const, content: userMessage },
    ];

    const resp = await this.config.provider.sendMessage({ messages, maxTokens: 4096 });
    this.totalCostUsd += resp.costUsd;

    await conversationStore.appendExchange(
      this.threadId,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: resp.content },
    );

    return resp.content;
  }

  async propose(): Promise<AgentProposal> {
    const { systemPrompt, userMessage } = buildProposalPrompt(this.config.role, this.config.task, this.config.tools ?? []);
    const raw = await this.call(systemPrompt, userMessage);
    const parsed = parseJSON<unknown>(raw, 'proposal');
    return AgentProposalSchema.parse(parsed);
  }

  async critique(peerRole: string, peerProposal: AgentProposal): Promise<AgentCritique> {
    const { systemPrompt, userMessage } = buildCritiquePrompt(
      this.config.role, this.config.task, peerRole, peerProposal,
    );
    const raw = await this.call(systemPrompt, userMessage);
    const parsed = parseJSON<unknown>(raw, 'critique');
    return AgentCritiqueSchema.parse(parsed);
  }

  async revise(originalProposal: AgentProposal, critiques: Array<{ role: string; critique: unknown }>): Promise<AgentProposal> {
    const { systemPrompt, userMessage } = buildRevisionPrompt(
      this.config.role, this.config.task, originalProposal, critiques,
    );
    const raw = await this.call(systemPrompt, userMessage);
    const parsed = parseJSON<unknown>(raw, 'revised proposal');
    return AgentProposalSchema.parse(parsed);
  }

  async vote(proposals: Array<{ role: string; proposal: AgentProposal }>): Promise<Vote> {
    const { systemPrompt, userMessage } = buildVotePrompt(this.config.role, this.config.task, proposals);
    const raw = await this.call(systemPrompt, userMessage);
    const parsed = parseJSON<unknown>(raw, 'vote');
    return VoteSchema.parse(parsed);
  }

  async implement(
    implementationPlan: string,
    tools: ITool[],
    maxIterations = 10,
  ): Promise<{ steps: ImplementationStep[]; finalResponse: AgentResponse }> {
    const toolMap = new Map(tools.map(t => [t.name, t]));
    const steps: ImplementationStep[] = [];

    const { systemPrompt, userMessage } = buildImplementationPrompt(
      this.config.role, this.config.task, implementationPlan, tools,
    );

    // First call — start implementation
    let raw = await this.call(systemPrompt, userMessage);
    let response = AgentResponseSchema.parse(parseJSON<unknown>(raw, 'implementation response'));

    const executeStep = async (iter: number): Promise<ImplementationStep> => {
      const toolResults: ImplementationStep['toolResults'] = [];
      for (const tc of response.toolCalls) {
        const tool = toolMap.get(tc.tool);
        if (!tool) {
          toolResults.push({ tool: tc.tool, success: false, output: null, error: `Unknown tool: ${tc.tool}` });
          continue;
        }
        const result = await this.useTool(tool, tc, tc.operation as string);
        toolResults.push({ tool: tc.tool, success: result.success, output: result.output, error: result.error });
      }
      return { iteration: iter, narrative: response.narrative, toolCalls: response.toolCalls, toolResults };
    };

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Always execute pending tool calls — even on status=complete, so open_pr
      // at the end of a task is never silently dropped at the iteration cap.
      if (response.toolCalls.length === 0) break;

      const step = await executeStep(iteration);
      steps.push(step);

      // If the agent is done or hit a blocking state, stop here.
      if (response.status !== 'in_progress') break;

      // Feed results back to agent and get next response.
      const resultMsg = buildToolResultMessage(
        response.toolCalls.map((tc, i) => ({
          tool: tc.tool,
          operation: tc.operation as string,
          success: step.toolResults[i].success,
          output: step.toolResults[i].output,
          error: step.toolResults[i].error,
        })),
      );
      raw = await this.call(systemPrompt, resultMsg);
      response = AgentResponseSchema.parse(parseJSON<unknown>(raw, 'implementation response'));
    }

    // If the loop hit maxIterations and the final response still has tool calls
    // (e.g. open_pr), execute them now so PRs aren't silently lost.
    if (response.toolCalls.length > 0 && steps[steps.length - 1]?.toolCalls !== response.toolCalls) {
      steps.push(await executeStep(steps.length));
    }

    return { steps, finalResponse: response };
  }

  async securityReview(prContent: string): Promise<SecurityReview> {
    const { systemPrompt, userMessage } = buildSecurityReviewPrompt(prContent, this.config.task);
    const raw = await this.call(systemPrompt, userMessage);
    const parsed = parseJSON<unknown>(raw, 'security review');
    return SecurityReviewSchema.parse(parsed);
  }

  async escalate(_reason: string): Promise<IAIProvider> {
    const tierMap = { fast: 'standard', standard: 'premium', premium: 'premium' } as const;
    const nextTier = tierMap[this.config.provider.tier];
    return createProvider(this.config.provider.provider, nextTier);
  }

  // Permission check happens before execution — never after.
  async useTool(tool: ITool, input: unknown, operation = 'execute'): Promise<ToolResult> {
    const permLevel = this.config.permissionLevel ?? 'read';
    const projectId = this.config.deliberationId;
    // Audit is fail-closed: if we can't write to the audit log, the tool call
    // must not proceed. Non-tool audit events (permission.evaluated etc.) are
    // allowed to warn-only since they don't gatekeep execution.
    const emitCritical = async (actionType: string, extra: Record<string, unknown> = {}) => {
      await globalAuditLog.append({
        projectId, actorType: 'agent', actorId: this.config.role,
        actionType, toolName: tool.name, ...extra,
      });
    };
    const emitWarn = (actionType: string, extra: Record<string, unknown> = {}) =>
      globalAuditLog.append({
        projectId, actorType: 'agent', actorId: this.config.role,
        actionType, toolName: tool.name, ...extra,
      }).catch(err => console.warn('[audit]', actionType, err));

    // 1. Emit tool.requested — fail-closed: if audit is unavailable, abort.
    try {
      await emitCritical('tool.requested', { inputSummary: summarise(input) });
    } catch (auditErr) {
      return {
        success: false, output: null,
        error: `Audit log unavailable — tool call aborted: ${String(auditErr).slice(0, 200)}`,
        metadata: { durationMs: 0 },
      };
    }

    // 2. Resolve gate policy for this operation — prefer context-aware override
    const gateCtx = { agentId: this.threadId, projectId };
    const gate = tool.getGate?.(operation, gateCtx) ?? tool.gates?.[operation] ?? 'approval_required';

    if (gate === 'always_deny') {
      emitWarn('permission.evaluated', { outputSummary: 'always_deny', approvalStatus: 'denied' });
      const denied: ToolResult = { success: false, output: null, error: `Operation ${tool.name}.${operation} is always denied.`, metadata: { durationMs: 0 } };
      emitWarn('tool.denied', { outputSummary: denied.error });
      return denied;
    }

    // 3. For approval_required: check if already approved; if not, create request
    if (gate === 'approval_required') {
      const alreadyApproved = await permissionEngine.checkApproved(projectId, tool.name, operation, input);
      if (!alreadyApproved) {
        // Check DB rules for a standing grant
        const perm = await permissionEngine.check(this.config.role, tool.name, operation, { projectId, input });
        emitWarn('permission.evaluated', { outputSummary: perm.reason, approvalStatus: perm.allowed ? 'approved' : 'pending' });
        if (!perm.allowed) {
          // No standing rule — request human approval, binding to the exact tool input
          const { requestId } = await permissionEngine.requestApproval(
            this.config.role, tool.name, operation,
            `Agent ${this.config.role} wants to use ${tool.name}.${operation}`,
            projectId,
            input,
          );

          // If approvalTimeoutMs is set, poll until the human resolves or timeout
          const timeoutMs = this.config.approvalTimeoutMs ?? 0;
          if (timeoutMs > 0) {
            const deadline = Date.now() + timeoutMs;
            let approved = false;
            while (Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 1000));
              const req = await permissionEngine.getRequest(requestId);
              if (req?.status === 'approved') { approved = true; break; }
              if (req?.status === 'denied') break;
            }
            if (approved) {
              emitWarn('permission.evaluated', { outputSummary: `approved by human (waited)`, approvalStatus: 'approved' });
              // Fall through to execute the tool below
            } else {
              emitWarn('tool.denied', { outputSummary: `Timed out or denied: ${requestId}` });
              return {
                success: false, output: null,
                error: `Approval denied or timed out for ${tool.name}.${operation}. Request ID: ${requestId}`,
                pendingApproval: false,
                metadata: { durationMs: 0 },
              };
            }
          } else {
            emitWarn('tool.denied', { outputSummary: `Pending approval: ${requestId}` });
            return {
              success: false, output: null,
              error: `Approval required for ${tool.name}.${operation}. Request ID: ${requestId}`,
              pendingApproval: true,
              requestId,
              metadata: { durationMs: 0 },
            };
          }
        }
      } else {
        emitWarn('permission.evaluated', { outputSummary: 'approved by prior human decision', approvalStatus: 'approved' });
      }
    } else {
      // auto_allow
      emitWarn('permission.evaluated', { outputSummary: 'auto_allow', approvalStatus: 'not_required' });
    }

    const legacyAuditLog = this.config.auditLog ?? (async () => {});
    const context: ToolContext = {
      agentId: this.threadId,
      projectId,
      permissionLevel: permLevel,
      auditLog: legacyAuditLog,
    };

    const result = await tool.execute(input, context);

    // 4. Append tool use + result to conversation thread — redact secrets
    const safeInput = redact(JSON.stringify(input));
    const safeOutput = redact(JSON.stringify(result.output));
    await conversationStore.appendExchange(
      this.threadId,
      { role: 'user', content: `[tool_use] ${tool.name}: ${safeInput}` },
      { role: 'assistant', content: `[tool_result] success=${result.success} output=${safeOutput}${result.error ? ` error=${result.error}` : ''}` },
    );

    // 5. Emit tool.executed or tool.failed — fail-closed: the result must be
    // recorded in the audit log; if it can't be, treat execution as failed.
    if (result.success) {
      try {
        await emitCritical('tool.executed', {
          outputSummary: summarise(result.output),
          approvalStatus: gate === 'auto_allow' ? 'not_required' : 'approved',
        });
      } catch (auditErr) {
        return {
          success: false, output: null,
          error: `Audit log unavailable after tool execution — result discarded: ${String(auditErr).slice(0, 200)}`,
          metadata: result.metadata,
        };
      }
    } else {
      emitWarn('tool.failed', { outputSummary: result.error ?? 'unknown error' });
    }

    return result;
  }
}
