import type { AgentRole } from '@consensus/shared-types';
import type { AgentProposal } from '@consensus/shared-types';
import type { ITool } from '@consensus/tools';

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  architect: 'You are a software architect. Focus on system design, scalability, and structural patterns.',
  devil_advocate: 'You are a devil\'s advocate. Challenge assumptions, identify failure modes, and stress-test proposals.',
  security_reviewer: 'You are a security reviewer. Identify vulnerabilities, threat vectors, and security risks.',
  performance_analyst: 'You are a performance analyst. Focus on latency, throughput, resource usage, and optimization.',
  ux_reviewer: 'You are a UX reviewer. Evaluate user experience, accessibility, and interface quality.',
  domain_expert: 'You are a domain expert. Apply business rules, domain knowledge, and requirements expertise.',
  integrator: 'You are an integrator. Synthesize multiple perspectives into a unified, coherent solution.',
};

function buildToolsSection(tools: ITool[]): string {
  if (tools.length === 0) return '';
  const list = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  return `\n## Available tools\n${list}\n\nTo use a tool, include in your JSON response:\n"toolCalls": [{ "tool": "filesystem", "operation": "read_file", "path": "src/index.ts" }]\n`;
}

const AGENT_RESPONSE_SCHEMA = `{
  "status": "in_progress" | "complete" | "blocked",
  "narrative": "string — what you did or are doing (one sentence, no code)",
  "toolCalls": [
    { "tool": "filesystem", "operation": "read_file", "path": "src/index.ts" }
  ],
  "prUrl": "string (optional — when PR is opened)",
  "prNumber": 42,
  "filesModified": ["path/to/file.ts"],
  "blockingIssues": ["issue1 (when status=blocked)"]
}

IMPORTANT: Every item in toolCalls MUST have both "tool" and "operation" fields. Keep "narrative" short — do NOT put file contents or code in the narrative field.`;

export interface ImplementationContext {
  memoryContext?: string;
  repoIntelligenceContext?: string;
}

export function buildImplementationPrompt(
  role: AgentRole,
  task: string,
  implementationPlan: string,
  tools: ITool[],
  ctx?: ImplementationContext,
): { systemPrompt: string; userMessage: string } {
  const toolList = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');
  const memorySections = [ctx?.repoIntelligenceContext, ctx?.memoryContext]
    .filter(Boolean)
    .join('\n\n');
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You are implementing a plan using real tools. Work iteratively:
1. Read relevant files to understand the current code
2. Write or modify files to implement the change
3. Verify with tsc/eslint before committing
4. Create a branch, commit the files, open a PR

Available tools:
${toolList}

Respond with ONLY valid JSON — no prose, no fences:
${AGENT_RESPONSE_SCHEMA}

Rules:
- Set status="in_progress" with toolCalls when you need to use tools
- Set status="complete" when the PR is opened (include prUrl, prNumber, filesModified)
- Set status="blocked" if you hit an unresolvable issue (include blockingIssues)
- One round of toolCalls per response — wait for results before the next round
- ONLY call tools from the Available tools list above`,
    userMessage: `Task: ${task}

Agreed implementation plan:
${implementationPlan}
${memorySections ? `\n${memorySections}\n` : ''}
Start by reading the relevant files. Then implement the plan step by step.`,
  };
}

export function buildProposalPromptWithContext(
  role: AgentRole,
  task: string,
  tools: ITool[],
  ctx?: ImplementationContext,
): { systemPrompt: string; userMessage: string } {
  const base = buildProposalPrompt(role, task, tools);
  if (!ctx?.memoryContext && !ctx?.repoIntelligenceContext) return base;
  const memorySections = [ctx?.repoIntelligenceContext, ctx?.memoryContext]
    .filter(Boolean)
    .join('\n\n');
  return {
    ...base,
    userMessage: `${base.userMessage}\n\n${memorySections}`,
  };
}

export function buildToolResultMessage(
  toolResults: Array<{ tool: string; operation: string; success: boolean; output: unknown; error?: string }>,
): string {
  const lines = toolResults.map(r =>
    `[${r.tool}.${r.operation}] ${r.success ? '✓' : '✗'} ${r.error ?? JSON.stringify(r.output).slice(0, 500)}`
  );
  return `Tool results:\n${lines.join('\n')}\n\nContinue implementing. Respond with the next JSON step.`;
}

export function buildSecurityReviewPrompt(
  prContent: string,
  task: string,
): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS['security_reviewer']}

Review a pull request for security issues. Respond with ONLY valid JSON:
{
  "approved": true | false,
  "findings": [
    { "severity": "info"|"low"|"medium"|"high"|"critical", "description": "string", "file": "string (optional)" }
  ],
  "blockingIssues": ["string — issues that MUST be fixed before merge"],
  "recommendation": "string — overall verdict"
}

Rules:
- Respond with ONLY the JSON object — no prose, no fences
- approved=false if any finding is high or critical severity
- blockingIssues only for high/critical findings`,
    userMessage: `Task context: ${task}

Pull request diff / content:
${prContent}

Review this for security issues.`,
  };
}

const JSON_PROPOSAL_SCHEMA = `{
  "recommendation": "string — your primary recommendation",
  "reasoning": ["string — reasoning step 1", "string — reasoning step 2"],
  "assumptions": ["string — assumption 1"],
  "risks": ["string — risk 1"],
  "confidence": 0.0-1.0
}`;

export function buildProposalPrompt(role: AgentRole, task: string, tools: ITool[] = []): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You are participating in a multi-agent deliberation. Analyse the task from your role's perspective and respond with ONLY valid JSON matching this schema:
${JSON_PROPOSAL_SCHEMA}${buildToolsSection(tools)}

Rules:
- Respond with ONLY the JSON object — no prose before or after, no markdown fences
- reasoning: 2-4 concise bullet strings (not a paragraph)
- assumptions: 1-3 strings
- risks: 1-3 strings
- confidence: 0.0-1.0 number`,
    userMessage: `Task: ${task}

Respond with ONLY the JSON object.`,
  };
}

export function buildCritiquePrompt(
  role: AgentRole,
  task: string,
  peerRole: string,
  peerProposal: AgentProposal,
): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You are reviewing a peer's proposal from your role's perspective. Respond with ONLY valid JSON:
{
  "targetAgentRole": "string",
  "challengedReasoningIndexes": [0, 1],
  "objections": ["string"],
  "agreements": ["string"],
  "isBlocking": true|false
}

challengedReasoningIndexes are the 0-based indexes into the peer's reasoning array that you dispute.
isBlocking means their proposal should not proceed as-is from your role's perspective.`,
    userMessage: `Task: ${task}

${peerRole}'s proposal:
${JSON.stringify(peerProposal, null, 2)}

Critique this proposal from your perspective as ${role}.`,
  };
}

export function buildRevisionPrompt(
  role: AgentRole,
  task: string,
  originalProposal: AgentProposal,
  critiques: Array<{ role: string; critique: unknown }>,
): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You have received critiques of your proposal. Revise it based on valid concerns. Respond with ONLY valid JSON matching the proposal schema:
${JSON_PROPOSAL_SCHEMA}`,
    userMessage: `Task: ${task}

Your original proposal:
${JSON.stringify(originalProposal, null, 2)}

Critiques received:
${JSON.stringify(critiques, null, 2)}

Revise your proposal addressing valid concerns. Maintain positions where critiques are not well-founded.`,
  };
}

export function buildVotePrompt(
  role: AgentRole,
  task: string,
  proposals: Array<{ role: string; proposal: AgentProposal }>,
): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You are voting on whether to accept the current set of proposals. Respond with ONLY valid JSON:
{
  "agentRole": "${role}",
  "vote": "accept"|"reject"|"abstain",
  "rationale": "string"
}`,
    userMessage: `Task: ${task}

Current proposals:
${JSON.stringify(proposals, null, 2)}

Cast your vote.`,
  };
}
