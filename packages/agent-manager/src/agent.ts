import type { IAIProvider } from './provider-interface.js';
import { conversationStore } from './conversation-store.js';
import { buildProposalPrompt, buildCritiquePrompt, buildRevisionPrompt, buildVotePrompt } from './prompts.js';
import { AgentProposalSchema, AgentCritiqueSchema, VoteSchema } from '@consensus/shared-types';
import type { AgentRole, AgentProposal, AgentCritique, Vote } from '@consensus/shared-types';
import { createProvider } from './provider-factory.js';
import type { ITool, ToolContext, ToolResult } from '@consensus/tools';
import { permissionEngine } from '@consensus/permissions';

export interface AgentConfig {
  provider: IAIProvider;
  role: AgentRole;
  deliberationId: string;
  task: string;
  tools?: ITool[];
  permissionLevel?: 'read' | 'write' | 'admin';
  auditLog?: (action: string, detail: unknown) => Promise<void>;
}

function parseJSON<T>(raw: string, label: string): T {
  // Strip all markdown code fences (anywhere in the string)
  let cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Find the outermost JSON object or array
  const objStart = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  let start = -1;
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) start = objStart;
  else if (arrStart !== -1) start = arrStart;

  if (start > 0) cleaned = cleaned.slice(start);

  // Find the matching closing bracket
  const opener = cleaned[0];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === opener) depth++;
    else if (cleaned[i] === closer) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end !== -1) cleaned = cleaned.slice(0, end + 1);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse ${label} JSON: ${raw.slice(0, 300)}`);
  }
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

    const resp = await this.config.provider.sendMessage({ messages, maxTokens: 2048 });
    this.totalCostUsd += resp.costUsd;

    await conversationStore.appendExchange(
      this.threadId,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: resp.content },
    );

    return resp.content;
  }

  async propose(): Promise<AgentProposal> {
    const { systemPrompt, userMessage } = buildProposalPrompt(this.config.role, this.config.task);
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

  async escalate(_reason: string): Promise<IAIProvider> {
    const tierMap = { fast: 'standard', standard: 'premium', premium: 'premium' } as const;
    const nextTier = tierMap[this.config.provider.tier];
    return createProvider(this.config.provider.provider, nextTier);
  }

  // Permission check happens before execution — never after.
  async useTool(tool: ITool, input: unknown, operation = 'execute'): Promise<ToolResult> {
    const permLevel = this.config.permissionLevel ?? 'read';

    // Check permission engine first — before any execution
    const perm = await permissionEngine.check(
      this.config.role,
      tool.name,
      operation,
      { projectId: this.config.deliberationId, input },
    );

    if (!perm.allowed) {
      // Also enforce local permission level as a fallback guard
      const requiredWrite = tool.permissions.includes('write');
      if (requiredWrite && permLevel === 'read') {
        return {
          success: false,
          output: null,
          error: `Permission denied: ${perm.reason}`,
          metadata: { durationMs: 0 },
        };
      }
      // If no DB rule but local level permits, allow through (open project default)
    }

    const auditLog = this.config.auditLog ?? (async () => {});
    const context: ToolContext = {
      agentId: this.threadId,
      projectId: this.config.deliberationId,
      permissionLevel: permLevel,
      auditLog,
    };

    const result = await tool.execute(input, context);

    // Append tool use + result to conversation thread so the agent sees what it did
    await conversationStore.appendExchange(
      this.threadId,
      { role: 'user', content: `[tool_use] ${tool.name}: ${JSON.stringify(input)}` },
      { role: 'assistant', content: `[tool_result] success=${result.success} output=${JSON.stringify(result.output)} ${result.error ? `error=${result.error}` : ''}` },
    );

    await auditLog('agent.useTool', {
      agentRole: this.config.role,
      tool: tool.name,
      input,
      success: result.success,
      durationMs: result.metadata.durationMs,
    });

    return result;
  }
}
