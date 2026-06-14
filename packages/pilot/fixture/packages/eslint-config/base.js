// @ts-check
import js from '@eslint/js';

/**
 * Base JavaScript best-practice rules.
 * Suitable for any JavaScript/TypeScript project.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const base = [
  // ESLint recommended rules
  js.configs.recommended,

  {
    rules: {
      // Enforce strict equality
      'eqeqeq': ['error', 'always'],

      // Prefer const over let when variable is never reassigned
      'prefer-const': 'error',

      // Disallow console.log in production code (use a logger instead)
      'no-console': 'warn',

      // Require consistent return values
      'consistent-return': 'error',

      // Disallow duplicate imports
      'no-duplicate-imports': 'error',

      // Disallow var declarations
      'no-var': 'error',

      // Require object shorthand methods and properties
      'object-shorthand': ['error', 'always'],

      // Prefer template literals over string concatenation
      'prefer-template': 'error',

      // Disallow unnecessary semicolons
      'no-extra-semi': 'error',

      // Prefer spread over .apply()
      'prefer-spread': 'error',

      // Disallow use of undefined as an identifier
      'no-undefined': 'off',

      // Require default cases in switch statements
      'default-case': 'error',

      // Disallow fallthrough in switch cases (unless intentional)
      'no-fallthrough': 'error',

      // Disallow returning values from setters
      'no-setter-return': 'error',

      // Disallow unused expressions
      'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
];

export default base;
