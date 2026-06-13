import { z } from 'zod';

export const AgentRoleSchema = z.enum([
  'architect',
  'devil_advocate',
  'security_reviewer',
  'performance_analyst',
  'ux_reviewer',
  'domain_expert',
  'integrator',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const SubtaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  assignedRole: AgentRoleSchema,
  dependencies: z.array(z.string()),
  wave: z.number().int().nonnegative(),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

export const SubtaskResultSchema = z.object({
  subtaskId: z.string(),
  agentRole: AgentRoleSchema,
  deliverable: z.string(),
  concerns: z.array(z.string()),
  completedAt: z.string().datetime(),
});
export type SubtaskResult = z.infer<typeof SubtaskResultSchema>;

export const CollaborationReportSchema = z.object({
  projectId: z.string(),
  task: z.string(),
  subtasks: z.array(SubtaskSchema),
  results: z.array(SubtaskResultSchema),
  integratedDocument: z.string(),
  completedAt: z.string().datetime(),
});
export type CollaborationReport = z.infer<typeof CollaborationReportSchema>;

export const CreateProjectRequestSchema = z.object({
  task: z.string().min(1),
  mode: z.enum(['debate', 'collaborate']),
  agents: z.array(z.object({
    provider: z.enum(['openai', 'anthropic', 'google']),
    tier: z.enum(['fast', 'standard', 'premium']),
    role: AgentRoleSchema,
  })).min(1),
  maxRounds: z.number().int().positive().default(3),
  budgetCap: z.number().positive().optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

// Role-fit keyword matching for task decomposition
export const ROLE_DOMAIN_KEYWORDS: Record<AgentRole, string[]> = {
  architect: ['architecture', 'design', 'structure', 'system', 'pattern', 'component', 'interface', 'api'],
  devil_advocate: ['risk', 'failure', 'edge case', 'assumption', 'problem', 'concern', 'issue'],
  security_reviewer: ['security', 'auth', 'vulnerability', 'threat', 'injection', 'permission', 'encrypt'],
  performance_analyst: ['performance', 'latency', 'throughput', 'cache', 'optimize', 'scale', 'memory'],
  ux_reviewer: ['user', 'ui', 'ux', 'interface', 'accessibility', 'flow', 'experience'],
  domain_expert: ['domain', 'business', 'logic', 'rule', 'requirement', 'specification'],
  integrator: ['integrate', 'assemble', 'combine', 'merge', 'unify', 'final', 'overall'],
};

export function bestFitRole(description: string, availableRoles: AgentRole[]): AgentRole {
  const lower = description.toLowerCase();
  let best: AgentRole = availableRoles[0];
  let bestScore = 0;
  for (const role of availableRoles) {
    const score = ROLE_DOMAIN_KEYWORDS[role].filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = role; }
  }
  return best;
}
