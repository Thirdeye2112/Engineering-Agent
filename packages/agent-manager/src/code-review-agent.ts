import type { IAIProvider } from './provider-interface.js';
import type { CodeReviewResult } from '@consensus/shared-types';
import { CodeReviewResultSchema } from '@consensus/shared-types';

function parseJSON<T>(raw: string): T {
  let cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const objStart = cleaned.indexOf('{');
  if (objStart > 0) cleaned = cleaned.slice(objStart);

  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }

  // Walk string-aware to find the closing brace, then parse the slice
  let depth = 0, inString = false, escape = false;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(0, i + 1)) as T; } catch { /* keep scanning */ }
      }
    }
  }
  throw new Error(`Failed to parse code-review JSON: ${raw.slice(0, 300)}`);
}

const SYSTEM_PROMPT = `You are a code reviewer. Your job is to review proposed file changes before they are approved.

For each review you must:
1. Identify bugs, unsafe patterns, missing error handling
2. Flag security issues (injection, path traversal, secret exposure, etc.)
3. Identify architectural drift from the existing codebase style
4. Note missing tests for critical paths
5. Decide a verdict: "approve", "request_changes", or "block"

Verdict rules:
- "block": critical security vulnerabilities, data loss risk, or fundamentally broken code
- "request_changes": bugs, missing tests for critical paths, or style violations
- "approve": change is correct, reasonably safe, and consistent with the codebase

Respond ONLY with valid JSON:
{
  "verdict": "approve" | "request_changes" | "block",
  "rationale": "string",
  "requiredFixes": ["fix1", "fix2"],
  "riskLevel": "low" | "medium" | "high" | "critical",
  "securityConcerns": ["concern1"],
  "testingGaps": ["gap1"]
}`;

export interface CodeReviewInput {
  path: string;
  originalContent: string;
  proposedContent: string;
  taskContext: string;
}

export class CodeReviewAgent {
  constructor(private provider: IAIProvider) {}

  async review(inputs: CodeReviewInput[]): Promise<CodeReviewResult> {
    const diffSection = inputs.map(({ path, originalContent, proposedContent }) => {
      return [
        `### File: ${path}`,
        `**Original:**\n\`\`\`\n${originalContent.slice(0, 2000)}\n\`\`\``,
        `**Proposed:**\n\`\`\`\n${proposedContent.slice(0, 2000)}\n\`\`\``,
      ].join('\n');
    }).join('\n\n---\n\n');

    const userMessage = [
      `Task context: ${inputs[0]?.taskContext ?? 'No context provided'}`,
      '',
      'Proposed changes to review:',
      diffSection,
    ].join('\n');

    const resp = await this.provider.sendMessage({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      maxTokens: 4096,
    });

    const parsed = parseJSON<unknown>(resp.content);
    return CodeReviewResultSchema.parse(parsed);
  }
}
