import { analyzeRepo } from '@consensus/memory';
import { projectMemory } from '@consensus/memory';
import { getDb, permissionRules } from '@consensus/db';
import { auditLog } from '@consensus/audit-log';
import type { OnboardingReport } from '@consensus/shared-types';

export interface OnboardingConfig {
  projectId: string;
  repoFullName?: string;
  sandboxRoot: string;
}

const HIGH_TRUST_INTERVENTION_THRESHOLD = 0.9;

/**
 * Analyses a repository and bootstraps the project with:
 * - Initial project memories (package manager, frameworks, conventions)
 * - Default permission rules for the implementation_agent role
 * Returns a structured report for display in the operator dashboard.
 */
export class OnboardingWorkflow {
  async run(config: OnboardingConfig): Promise<OnboardingReport> {
    const { projectId, repoFullName, sandboxRoot } = config;
    const completedAt = new Date().toISOString();
    let memoriesWritten = 0;
    let permissionRulesCreated = 0;

    const intel = analyzeRepo(sandboxRoot);

    // ── Write initial project memories ───────────────────────────────────────
    const memoryInputs: Array<Parameters<typeof projectMemory.write>[0]> = [
      {
        projectId,
        repoFullName,
        category: 'repo_convention',
        title: `Package manager: ${intel.packageManager}`,
        content: `This project uses ${intel.packageManager} as its package manager.${intel.isMonorepo ? ' It is a monorepo.' : ''}`,
        sourceType: 'agent_decision',
        confidence: 0.95,
      },
    ];

    if (intel.frameworks.length > 0) {
      memoryInputs.push({
        projectId,
        repoFullName,
        category: 'architecture_decision',
        title: `Detected frameworks: ${intel.frameworks.join(', ')}`,
        content: `The repository uses the following frameworks/libraries: ${intel.frameworks.join(', ')}.`,
        sourceType: 'agent_decision',
        confidence: 0.85,
      });
    }

    if (intel.testCommands.length > 0) {
      memoryInputs.push({
        projectId,
        repoFullName,
        category: 'repo_convention',
        title: `Test command: ${intel.testCommands[0]}`,
        content: `Run tests with: ${intel.testCommands[0]}`,
        sourceType: 'agent_decision',
        confidence: 0.9,
      });
    }

    if (intel.lintCommands.length > 0) {
      memoryInputs.push({
        projectId,
        repoFullName,
        category: 'repo_convention',
        title: `Lint command: ${intel.lintCommands[0]}`,
        content: `Run linting with: ${intel.lintCommands[0]}`,
        sourceType: 'agent_decision',
        confidence: 0.9,
      });
    }

    if (intel.hasTypeScript) {
      memoryInputs.push({
        projectId,
        repoFullName,
        category: 'repo_convention',
        title: 'TypeScript project',
        content: 'This is a TypeScript project. Always write .ts files, not .js.',
        sourceType: 'agent_decision',
        confidence: 0.95,
      });
    }

    for (const mem of memoryInputs) {
      try {
        await projectMemory.write(mem);
        memoriesWritten++;
      } catch (err) {
        console.warn('[onboarding] memory write failed:', err);
      }
    }

    // ── Create default permission rules ──────────────────────────────────────
    const db = getDb();

    // implementation_agent: read+write to filesystem within sandbox
    // Security reviewer and test runner remain gated by their own logic
    const rules = [
      {
        projectId,
        agentRole: 'implementation_agent',
        tool: 'filesystem',
        operations: JSON.stringify(['write_file', 'create_dir', 'read_file', 'list_dir']),
        level: 'write',
      },
      {
        projectId,
        agentRole: 'implementation_agent',
        tool: 'github',
        operations: JSON.stringify(['get_repo', 'list_files', 'read_file']),
        level: 'read',
      },
      {
        projectId,
        agentRole: '*',
        tool: 'safe_test_runner',
        operations: JSON.stringify(['run']),
        level: 'read',
      },
    ];

    for (const rule of rules) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db.insert(permissionRules) as any).values({
          projectId: rule.projectId,
          agentRole: rule.agentRole,
          tool: rule.tool,
          operations: JSON.parse(rule.operations),
          level: rule.level,
        });
        permissionRulesCreated++;
      } catch (err) {
        console.warn('[onboarding] permission rule create failed:', err);
      }
    }

    await auditLog.append({
      projectId,
      actorType: 'system',
      actorId: 'onboarding-workflow',
      actionType: 'project.onboarded',
      inputSummary: `repo=${repoFullName ?? sandboxRoot} frameworks=${intel.frameworks.join(',') || 'none'}`,
      outputSummary: `memories=${memoriesWritten} rules=${permissionRulesCreated}`,
      approvalStatus: 'not_required',
    }).catch(() => {});

    return {
      projectId,
      repoFullName,
      packageManager: intel.packageManager,
      isMonorepo: intel.isMonorepo,
      frameworks: intel.frameworks,
      testCommand: intel.testCommands[0],
      lintCommand: intel.lintCommands[0],
      typecheckCommand: intel.typecheckCommands?.[0],
      hasTypeScript: intel.hasTypeScript,
      hasCiConfig: intel.hasCiConfig,
      memoriesWritten,
      permissionRulesCreated,
      completedAt,
    };
  }
}

export const HIGH_TRUST_THRESHOLD = HIGH_TRUST_INTERVENTION_THRESHOLD;
export const onboardingWorkflow = new OnboardingWorkflow();
