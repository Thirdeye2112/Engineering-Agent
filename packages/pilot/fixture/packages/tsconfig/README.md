# @pilot-utils/tsconfig

Shared TypeScript base configuration for the pilot-utils monorepo.

## Usage

Extend from `tsconfig.base.json` in any package's `tsconfig.json`:

```json
{
  "extends": "../../packages/tsconfig/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": []
}
```

## Features

- **Strict mode** — all strict type-checking flags enabled
- **`noUncheckedIndexedAccess`** — safer array/object indexing
- **`exactOptionalPropertyTypes`** — stricter optional property handling
- **`noImplicitOverride`** — explicit `override` keyword required
- **`composite`** — enables TypeScript project references for incremental builds
- **`declarationMap`** — source maps for `.d.ts` files for better IDE navigation
- **`forceConsistentCasingInFileNames`** — prevents case-sensitivity bugs
