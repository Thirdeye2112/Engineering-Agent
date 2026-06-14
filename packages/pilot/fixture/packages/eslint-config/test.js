// @ts-check

/**
 * Relaxed ESLint rules for test files.
 * Disables rules that are too strict for test code.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const test = [
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**/*.ts'],
    rules: {
      // Test files often log output intentionally
      'no-console': 'off',

      // Return types are noisy in tests
      '@typescript-eslint/explicit-function-return-type': 'off',

      // Tests may need `any` for mocking purposes
      '@typescript-eslint/no-explicit-any': 'warn',

      // Non-null assertions are common in test assertions
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Consistent return is relaxed in tests
      'consistent-return': 'off',

      // Tests may use magic numbers for clarity
      '@typescript-eslint/no-magic-numbers': 'off',

      // Empty functions are common in mocks/stubs
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
];

export default test;
