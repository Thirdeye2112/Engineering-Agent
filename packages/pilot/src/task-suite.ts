import type { PilotTask } from './types.js';

/**
 * 5 canned tasks exercising different implementation patterns.
 * All target the fixture repo at packages/pilot/fixture/.
 */
export const PILOT_TASKS: PilotTask[] = [
  {
    id: 'task-1-slugify',
    label: 'Add slugify utility',
    description: 'Pure utility function — add slugify() with tests',
    retryable: true,
    expectedFiles: ['src/utils.ts', 'src/utils.test.ts'],
    prompt: [
      'Add a slugify(text: string): string utility function to src/utils.ts.',
      'The function should:',
      '  1. Trim whitespace',
      '  2. Lowercase the entire string',
      '  3. Replace spaces and underscores with hyphens',
      '  4. Remove characters that are not alphanumeric or hyphens',
      '  5. Collapse consecutive hyphens into one',
      '  6. Remove leading and trailing hyphens',
      'Add 5 tests for slugify() in src/utils.test.ts.',
      'Do not modify existing functions or tests.',
      'Use batch_commit to commit both files in one operation.',
    ].join('\n'),
  },
  {
    id: 'task-2-readme',
    label: 'Update README usage section',
    description: 'Update README — add API usage examples for all exported functions',
    retryable: true,
    expectedFiles: ['README.md'],
    prompt: [
      'Update README.md to add a "## API" section documenting the exported functions.',
      'For each function (capitalize, truncate, camelCase), provide:',
      '  - A one-line description',
      '  - A TypeScript usage example',
      'Insert the section after any existing content. Do not remove existing content.',
      'Use batch_commit to commit the file.',
    ].join('\n'),
  },
  {
    id: 'task-3-add-test',
    label: 'Add edge-case tests for truncate',
    description: 'Add unit tests — edge cases for existing truncate() function',
    retryable: true,
    expectedFiles: ['src/utils.test.ts'],
    prompt: [
      'Add 3 edge-case tests for the truncate() function in src/utils.test.ts:',
      '  1. truncate with maxLen equal to string length (no ellipsis)',
      '  2. truncate with maxLen of 0 (returns "...")',
      '  3. truncate with a string containing only spaces',
      'Do not modify existing tests or implementation.',
      'Use batch_commit to commit the test file.',
    ].join('\n'),
  },
  {
    id: 'task-4-fix-bug',
    label: 'Fix camelCase bug for single-word input',
    description: 'Bug fix — camelCase("hello") should return "hello" not "Hello"',
    retryable: true,
    expectedFiles: ['src/utils.ts', 'src/utils.test.ts'],
    prompt: [
      'The camelCase() function in src/utils.ts has a subtle issue:',
      '  camelCase("hello") returns "Hello" because the capitalize() helper is applied',
      '  to all words including the first one.',
      'Fix camelCase() so the first word is lowercased, subsequent words are capitalized.',
      'Add a regression test in src/utils.test.ts: camelCase("hello") === "hello"',
      'Do not break the existing camelCase tests.',
      'Use batch_commit to commit both files.',
    ].join('\n'),
  },
  {
    id: 'task-5-type-guard',
    label: 'Add isNonEmptyString type guard',
    description: 'Add type guard helper — isNonEmptyString(val): val is string',
    retryable: true,
    expectedFiles: ['src/utils.ts', 'src/utils.test.ts'],
    prompt: [
      'Add a type guard function to src/utils.ts:',
      '  export function isNonEmptyString(val: unknown): val is string {',
      '    return typeof val === "string" && val.trim().length > 0;',
      '  }',
      'Add 4 tests in src/utils.test.ts:',
      '  - isNonEmptyString("hello") === true',
      '  - isNonEmptyString("") === false',
      '  - isNonEmptyString("   ") === false',
      '  - isNonEmptyString(42) === false',
      'Do not modify existing functions or tests.',
      'Use batch_commit to commit both files.',
    ].join('\n'),
  },
];

export function getTaskById(id: string): PilotTask | undefined {
  return PILOT_TASKS.find(t => t.id === id);
}
