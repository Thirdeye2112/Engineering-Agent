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

export function buildImplementationPrompt(
  role: AgentRole,
  task: string,
  implementationPlan: string,
  tools: ITool[],
): { systemPrompt: string; userMessage: string } {
  return {
    systemPrompt: `${ROLE_DESCRIPTIONS[role]}

You are implementing an agreed plan using available tools. Work iteratively: read files to understand, write files to implement, verify with tsc/eslint.${buildToolsSection(tools)}

Respond with ONLY valid JSON matching this schema:
${JSON_PROPOSAL_SCHEMA}
Include a "toolCalls" array if you need to use tools.`,
    userMessage: `Task: ${task}\n\nAgreed implementation plan:\n${implementationPlan}\n\nImplement this plan step by step. Report what you did and the outcome.`,
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
