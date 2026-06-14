// @ts-check
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/**
 * TypeScript-aware ESLint configuration.
 * Extends the base config with TypeScript-specific rules and import ordering.
 *
 * @param {Object} [options]
 * @param {string} [options.project] - Path to tsconfig.json (defaults to './tsconfig.json')
 * @param {string} [options.tsconfigRootDir] - Root directory for tsconfig resolution
 * @returns {import('eslint').Linter.Config[]}
 */
export function typescript(options = {}) {
  const { project = './tsconfig.json', tsconfigRootDir = process.cwd() } = options;

  return tseslint.config(
    // Include base rules
    ...base,

    // TypeScript recommended rules
    ...tseslint.configs.recommended,

    {
      // Apply to all TypeScript files
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: {
        parserOptions: {
          project,
          tsconfigRootDir,
        },
      },
      rules: {
        // ── Unused variables ────────────────────────────────────────────────
        // Disable base rule in favour of TS-aware version
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            vars: 'all',
            args: 'after-used',
            ignoreRestSiblings: true,
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],

        // ── Type safety ─────────────────────────────────────────────────────
        // Disallow explicit `any` type
        '@typescript-eslint/no-explicit-any': 'error',

        // Prefer nullish coalescing over ||  for nullable values
        '@typescript-eslint/prefer-nullish-coalescing': 'warn',

        // Prefer optional chaining over manual null checks
        '@typescript-eslint/prefer-optional-chain': 'warn',

        // No unnecessary type assertions
        '@typescript-eslint/no-unnecessary-type-assertion': 'error',

        // Disallow non-null assertions (!) — prefer proper null checks
        '@typescript-eslint/no-non-null-assertion': 'warn',

        // ── Return types ─────────────────────────────────────────────────────
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          {
            allowExpressions: true,
            allowTypedFunctionExpressions: true,
          },
        ],

        // ── Imports ──────────────────────────────────────────────────────────
        // Use type-only imports where possible
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],

        // Use type-only exports where possible
        '@typescript-eslint/consistent-type-exports': [
          'error',
          { fixMixedExportsWithInlineTypeSpecifier: true },
        ],

        // ── Code style ───────────────────────────────────────────────────────
        // Avoid inferrable types (e.g. `const x: string = 'foo'`)
        '@typescript-eslint/no-inferrable-types': 'warn',

        // Consistent array type style: prefer T[] over Array<T>
        '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],

        // Prefer `interface` over `type` for object shapes
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],

        // No useless empty exports (module augmentation guard)
        '@typescript-eslint/no-useless-empty-export': 'error',

        // Disallow `require()` in TS files
        '@typescript-eslint/no-require-imports': 'error',
      },
    },
  );
}

export default typescript;
