import type { IAIProvider } from './provider-interface.js';
import type { TestPlanResult } from '@consensus/shared-types';
import { TestPlanResultSchema } from '@consensus/shared-types';

function parseJSON<T>(raw: string): T {
  let cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const objStart = cleaned.indexOf('{');
  if (objStart > 0) cleaned = cleaned.slice(objStart);
  const end = (() => {
    let depth = 0;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  })();
  if (end !== -1) cleaned = cleaned.slice(0, end + 1);
  return JSON.parse(cleaned) as T;
}

const SYSTEM_PROMPT = `You are a test planning expert. Given a set of proposed file changes and a task description, produce a structured test plan.

Categorize test items as:
- "required_before_pr": must be verified before this PR can merge
- "recommended": nice-to-have, can be tracked as follow-up
- "not_applicable": genuinely not needed for this change

Test types: "unit", "integration", "e2e", "manual"

Respond ONLY with valid JSON:
{
  "requiredBeforePr": [
    { "description": "string", "type": "unit" | "integration" | "e2e" | "manual", "priority": "required_before_pr" }
  ],
  "recommended": [
    { "description": "string", "type": "unit", "priority": "recommended" }
  ],
  "notApplicable": [
    { "description": "string", "type": "unit", "priority": "not_applicable" }
  ],
  "summary": "string"
}`;

export interface TestPlanInput {
  taskContext: string;
  filesChanged: string[];
  proposedChangeSummary: string;
}

export class TestPlanAgent {
  constructor(private provider: IAIProvider) {}

  async plan(input: TestPlanInput): Promise<TestPlanResult> {
    const userMessage = [
      `Task: ${input.taskContext}`,
      `Files changed: ${input.filesChanged.join(', ')}`,
      `Change summary: ${input.proposedChangeSummary}`,
    ].join('\n');

    const resp = await this.provider.sendMessage({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 1024,
    });

    const parsed = parseJSON<unknown>(resp.content);
    return TestPlanResultSchema.parse(parsed);
  }
}
