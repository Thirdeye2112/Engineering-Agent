# Consensus AI — Credential Hardening Design

**Version:** 1.0  
**Last updated:** 2026-06-13  
**Status:** Design + Immediate Action Items — not yet fully implemented

---

## Section 1: Current Risk Areas

The following locations in the codebase currently expose plaintext secrets or create paths for accidental secret leakage. Each is a concrete file and line range, not a hypothetical.

### 1.1 `.env` File — Plaintext Key on Disk

**File:** `/home/user/Engineering-Agent/.env`

The `.env` file contains a live `ANTHROPIC_API_KEY` value beginning `sk-ant-api03-u4uCoboBAT7...`. This file is not in `.gitignore` (unverified — must be confirmed). If committed, the key is permanently in git history even after deletion.

**Risk:** Critical. One accidental `git add .` exposes the key to anyone with repo access.

---

### 1.2 `process.env` Access Scattered Across Packages

`process.env` is read directly in at least the following files with no abstraction layer:

| File | Secret accessed |
|------|----------------|
| `packages/agent-manager/src/providers/anthropic.ts:15` | `ANTHROPIC_API_KEY` |
| `packages/agent-manager/src/providers/openai.ts:15` | `OPENAI_API_KEY` |
| `packages/agent-manager/src/providers/google.ts:15` | `GOOGLE_API_KEY` |
| `packages/tools/src/github.ts:37–40` | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO` |
| `packages/agent-manager/src/conversation-store.ts:18` | `REDIS_URL` (contains auth if set) |
| `packages/db/src/index.ts:19` | `DATABASE_URL` (contains password) |
| `packages/api-server/src/index.ts:140` | `FILESYSTEM_SANDBOX_ROOT` (path, low risk) |

A `SecretManager` interface exists at `packages/secrets/src/manager.ts` but these files have not been migrated to use it.

---

### 1.3 `POST /credentials` Endpoint — Unauthenticated Runtime Key Mutation

**File:** `packages/api-server/src/index.ts:213–220`

```typescript
app.post('/credentials', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) {
    if (ALLOWED_ENV_KEYS.includes(k) && typeof v === 'string' && v.length > 4) {
      process.env[k] = v;
    }
  }
  res.json({ ok: true });
});
```

**Risk:** This endpoint has no authentication, no rate limiting, and no logging. Any client that can reach the API server can overwrite `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, and `GITHUB_TOKEN` at runtime. In a deployed environment, this is a complete credential hijack vector.

**Comment in source:** `// Allow frontend to update runtime API keys (local dev only)` — this comment must become an enforced constraint, not a hint.

---

### 1.4 Agent Prompts May Echo Tool Inputs

**File:** `packages/agent-manager/src/agent.ts:240–241`

Tool inputs are serialized with `JSON.stringify(input)` and appended to the conversation thread stored in Redis:

```typescript
{ role: 'user', content: `[tool_use] ${tool.name}: ${JSON.stringify(input)}` },
```

If a tool input contains a secret (e.g., a GitHub token passed as a parameter, or a file write containing a credentials file), that value is stored in Redis in plaintext and may be replayed into future agent context windows.

---

### 1.5 Audit Log Output Summaries

**File:** `packages/secrets/src/redact.ts` (exists)  
**File:** `packages/agent-manager/src/agent.ts:244–250`

The `auditLog` call at `agent.ts:244` logs `input` directly:

```typescript
await auditLog('agent.useTool', {
  agentRole: this.config.role,
  tool: tool.name,
  input,           // <-- raw tool input, not redacted
  success: result.success,
  durationMs: result.metadata.durationMs,
});
```

The `redact` / `summarise` functions in `packages/secrets/src/redact.ts` exist but are not called at this call site. If `input` contains a secret value, it is written to the audit log verbatim.

---

### 1.6 `console.error` Stack Traces

**File:** `packages/api-server/src/index.ts:151, 239`

```typescript
console.error('[Project error]', err);
console.error('[Consensus AI] Startup failed:', err);
```

Node.js error objects can include the originating call stack, environment context, and in some cases the full error message from a failed API call — which may include the key prefix or last-used request headers in third-party SDK errors.

---

## Section 2: Secret Manager Abstraction

A `SecretManager` interface already exists at `packages/secrets/src/manager.ts`. The design below documents the intended full interface and planned implementations.

### 2.1 Interface

```typescript
export interface SecretManager {
  /** Retrieve a secret by logical name. Returns undefined if not set. */
  get(key: string): string | undefined;

  /** Check whether a secret is configured (non-empty). */
  exists(key: string): boolean;

  /**
   * Rotate a secret to a new value.
   * In EnvSecretManager: mutates process.env (dev only, behind ALLOW_ENV_MUTATION guard).
   * In VaultSecretManager: calls vault.kv.write() and invalidates in-memory cache.
   * In AWSSecretsManagerProvider: calls PutSecretValue and waits for replication.
   */
  rotate(key: string, newValue: string): Promise<void>;
}
```

**Note:** The current `set()` method on `EnvSecretManager` is synchronous. Rename to `rotate()` returning `Promise<void>` to force implementors to handle async rotation correctly and to make it clear this is not a normal write path.

### 2.2 `EnvSecretManager` (Default / Dev)

Already implemented. Required changes:
- Guard `set()` / `rotate()` behind `if (process.env.NODE_ENV !== 'production') throw new Error(...)` to prevent accidental use in deployed environments.
- Add `rotate()` async wrapper that calls `set()` internally.

### 2.3 `VaultSecretManager` (Planned)

```typescript
export class VaultSecretManager implements SecretManager {
  constructor(private vaultAddr: string, private token: string, private mountPath = 'secret') {}

  async get(key: string): Promise<string | undefined> {
    // GET {vaultAddr}/v1/{mountPath}/data/{key}
    // Cache with TTL (e.g., 60s) — do not call Vault on every agent message
  }

  async exists(key: string): Promise<boolean> { ... }

  async rotate(key: string, newValue: string): Promise<void> {
    // POST {vaultAddr}/v1/{mountPath}/data/{key}
    // Invalidate local cache entry
    // Emit rotation event to audit log
  }
}
```

### 2.4 `AWSSecretsManagerProvider` (Planned)

```typescript
export class AWSSecretsManagerProvider implements SecretManager {
  constructor(private client: SecretsManagerClient, private prefix = '/consensus-ai/') {}

  async get(key: string): Promise<string | undefined> {
    // GetSecretValue({ SecretId: prefix + key })
    // Parse SecretString as JSON if applicable
  }

  async rotate(key: string, newValue: string): Promise<void> {
    // PutSecretValue — triggers automatic rotation lambda if configured
    // Wait for VersionStage AWSCURRENT to propagate before returning
  }
}
```

### 2.5 Migration Path

All direct `process.env.X` reads in provider files and tools should be replaced with:

```typescript
import { getSecretManager } from '@consensus/secrets';
const key = getSecretManager().get('anthropicKey');
```

This is a mechanical change — the `ENV_KEY_MAP` in `EnvSecretManager` already maps logical names to env var names.

---

## Section 3: Redaction Rules

### 3.1 Patterns

The following patterns are already defined in `packages/secrets/src/redact.ts`. They are reproduced here for reference and to track coverage:

| Name | Prefix | Full pattern | Example match |
|------|--------|-------------|---------------|
| `anthropic-key` | `sk-ant-api` | `/sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{93}/g` | `sk-ant-api03-…` |
| `openai-key` | `sk-` | `/sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g` | `sk-proj-…` |
| `google-key` | `AIza` | `/AIza[A-Za-z0-9_-]{35}/g` | `AIzaSy…` |
| `github-pat-new` | `github_pat_` | `/github_pat_[A-Za-z0-9_]{82}/g` | `github_pat_…` |
| `github-pat` | `ghp_` | `/ghp_[A-Za-z0-9]{36}/g` | `ghp_…` |
| `github-oauth` | `gho_` | `/gho_[A-Za-z0-9]{36}/g` | `gho_…` |

**Gap:** `DATABASE_URL` and `REDIS_URL` may contain embedded passwords (e.g., `postgresql://user:password@host/db`). Add a pattern:
- `database-url-password`: `/(?:postgresql|postgres|redis):\/\/[^:]+:([^@]+)@/g` — replace the capture group (password segment) with `[REDACTED:db-password]`.

### 3.2 Where Redaction Must Be Applied

| Location | Current status | Required action |
|----------|---------------|-----------------|
| Audit log `input` field (`agent.ts:244`) | NOT redacted | Wrap `input` with `redactObject(input)` before passing to `auditLog` |
| Conversation thread appended to Redis (`agent.ts:240`) | NOT redacted | Apply `redact()` to the `JSON.stringify(input)` string |
| `tool_result` output string (`agent.ts:241`) | NOT redacted | Apply `redact()` to `JSON.stringify(result.output)` |
| `console.error` in `api-server/src/index.ts:151` | NOT redacted | Wrap error message with `redact(String(err))` before logging |
| `console.error` in `api-server/src/index.ts:239` | NOT redacted | Same |
| Audit log event output (wherever `result.output` is logged) | Varies | Use `summarise()` from `packages/secrets/src/redact.ts` consistently |

The `summarise()` function in `packages/secrets/src/redact.ts` already does redact-then-truncate. It should be the canonical path for any value going to storage or logs.

---

## Section 4: Pre-commit Secret Scanning

### 4.1 Hook Script

Place at `.git/hooks/pre-commit` (or distribute via Husky / lefthook as `.husky/pre-commit`):

```bash
#!/usr/bin/env bash
set -euo pipefail

PATTERNS=(
  'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{93}'
  'sk-(?:proj-)?[A-Za-z0-9_-]{40,}'
  'AIza[A-Za-z0-9_-]{35}'
  'github_pat_[A-Za-z0-9_]{82}'
  'ghp_[A-Za-z0-9]{36}'
  'gho_[A-Za-z0-9]{36}'
)

STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED" ]; then
  exit 0
fi

FOUND=0
for PATTERN in "${PATTERNS[@]}"; do
  MATCHES=$(git diff --cached -U0 | grep '^\+' | grep -P "$PATTERN" || true)
  if [ -n "$MATCHES" ]; then
    echo "ERROR: Potential secret detected matching pattern: $PATTERN"
    echo "$MATCHES" | head -5
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "Commit blocked. Remove secrets before committing."
  echo "If this is a false positive, use: git commit --no-verify (requires explicit override)"
  exit 1
fi

exit 0
```

### 4.2 What It Detects

- All six patterns from Section 3.1
- Only scans lines being added (`grep '^\+'`) — does not fire on context lines or deletions
- Scans all staged file types, including `.env`, `.json`, `.ts`, `.md`

### 4.3 Limitations

- Does not scan git history; only staged diff
- Does not catch base64-encoded secrets
- Does not catch secrets in binary files
- `--no-verify` bypasses it — team policy must prohibit this for secret files

### 4.4 Distribution

Add to `package.json` scripts and configure via `lefthook.yml` or `.husky/pre-commit` so the hook is installed automatically on `npm install` / `pnpm install`. Do not rely on manual `.git/hooks` installation.

---

## Section 5: Rotation Process

### 5.1 Anthropic API Key

**When to rotate:** On any suspected exposure, on any team member departure with key access, every 90 days.

| Step | Action |
|------|--------|
| 1 | Log into console.anthropic.com → API Keys → Revoke the current key |
| 2 | Generate a new key |
| 3 | Update `.env`: set `ANTHROPIC_API_KEY=<new-value>` |
| 4 | If deployed: update the secret in the secret manager (Vault / AWS SM) directly — do NOT use `POST /credentials` in production |
| 5 | Restart all processes that loaded the key at startup (`api-server`, any worker processes) |
| 6 | Verify old key is purged: `grep -r 'sk-ant-api03' .` should return no results (excluding `.git` history) |
| 7 | Confirm liveness: `curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/models` → expect 200 |
| 8 | Confirm old key is dead: test the old key value → expect 401 |

---

### 5.2 OpenAI API Key

| Step | Action |
|------|--------|
| 1 | platform.openai.com → API Keys → Delete current key |
| 2 | Create new key with minimum required permissions |
| 3 | Update `.env` and/or secret manager: `OPENAI_API_KEY=<new-value>` |
| 4 | Restart `api-server` |
| 5 | Verify: `grep -r 'sk-' packages/ --include='*.env'` — should return no matches |

---

### 5.3 Google API Key

| Step | Action |
|------|--------|
| 1 | console.cloud.google.com → Credentials → Delete current key |
| 2 | Create new key; restrict to Generative Language API only |
| 3 | Update `.env`: `GOOGLE_API_KEY=<new-value>` |
| 4 | Restart `api-server` |
| 5 | Verify no old key in Redis: `redis-cli FLUSHDB` if conversation store may have cached it |

---

### 5.4 GitHub Token

| Step | Action |
|------|--------|
| 1 | github.com → Settings → Developer settings → Personal access tokens → Revoke |
| 2 | Generate new token with minimum scopes: `repo` (or `contents:write` for fine-grained) |
| 3 | Update `.env`: `GITHUB_TOKEN=<new-value>` |
| 4 | Restart `api-server` (token is read at request time via `process.env`, but restart is safest) |
| 5 | Verify old token is dead: `curl -H "Authorization: Bearer <old-token>" https://api.github.com/user` → expect 401 |

---

### 5.5 Database Password (DATABASE_URL)

| Step | Action |
|------|--------|
| 1 | Connect as superuser: `ALTER USER consensus PASSWORD '<new-password>';` |
| 2 | Update `.env`: `DATABASE_URL=postgresql://consensus:<new-password>@host/consensus_ai` |
| 3 | Restart all services that hold connection pools |
| 4 | Verify: `psql $DATABASE_URL -c 'SELECT 1'` → expect result |

---

### 5.6 Memory / Cache Purge After Any Rotation

After rotating any key:
1. Flush Redis conversation store: `redis-cli -u $REDIS_URL FLUSHDB` — this destroys in-flight agent threads but removes any cached context that may contain old key values
2. Restart all Node processes — `process.env` is loaded at startup; running processes hold the old value in memory until restarted
3. Check audit log for the 48 hours prior to rotation for any `[REDACTED]` entries that indicate the old key was written to storage and may need to be scrubbed

---

## Section 6: Immediate Action Items

Ordered by risk severity. Each item is a specific code change.

| Priority | File | Change |
|----------|------|--------|
| P0 | `.env` | Confirm `.env` is in `.gitignore`. If not, add it immediately and run `git rm --cached .env`. Rotate the live `ANTHROPIC_API_KEY` that is currently in `.env` — it must be treated as compromised. |
| P0 | `packages/api-server/src/index.ts:213` | Add authentication to `POST /credentials`. At minimum, require a `Bearer` token checked against an `ADMIN_SECRET` env var. Log all calls to this endpoint via audit log. Block in production with `if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'Disabled in production' })`. |
| P1 | `packages/agent-manager/src/agent.ts:240–241` | Wrap `JSON.stringify(input)` with `redact()` from `@consensus/secrets` before appending to conversation thread in Redis. Wrap `JSON.stringify(result.output)` the same way. |
| P1 | `packages/agent-manager/src/agent.ts:244` | Replace `input` with `redactObject(input)` in the `auditLog('agent.useTool', ...)` call. |
| P1 | `packages/api-server/src/index.ts:151,239` | Replace `console.error('[Project error]', err)` with `console.error('[Project error]', redact(String(err)))`. Import `redact` from `@consensus/secrets`. |
| P2 | `packages/agent-manager/src/providers/anthropic.ts:15` | Replace `process.env.ANTHROPIC_API_KEY` with `getSecretManager().get('anthropicKey')`. Repeat for `openai.ts` and `google.ts`. |
| P2 | `packages/tools/src/github.ts:37` | Replace `process.env.GITHUB_TOKEN` with `getSecretManager().get('githubToken')`. |
| P2 | `packages/secrets/src/manager.ts` | Add `rotate()` async method to interface. Guard `EnvSecretManager.set()` to throw in `NODE_ENV=production`. |
| P3 | `.git/hooks/pre-commit` (or `lefthook.yml`) | Install pre-commit secret scanning hook from Section 4. Add `prepare` script to `package.json` to install it automatically. |
| P3 | `packages/secrets/src/redact.ts` | Add `database-url-password` pattern to `SECRET_PATTERNS` array to redact embedded passwords in connection strings. |
| P4 | `packages/agent-manager/src/agent.ts` | Add E2E test: pass a string containing `sk-ant-api03-test...` as tool input; assert audit log entry contains `[REDACTED:anthropic-key]` and not the original string. |
