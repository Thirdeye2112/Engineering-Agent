# Security Red-Team Plan

**Status:** Initial coverage complete — see "How to run" before expanding write access.  
**Last updated:** 2026-06-13

---

## 1. Scope

### In scope

| Component | What is tested |
|---|---|
| **PermissionEngine** (`packages/permissions/src/engine.ts`) | Default-deny, wildcard rules, role/tool/operation scoping, approval gate bypass, SQL-injection in rationale field |
| **FilesystemTool** (`packages/tools/src/filesystem.ts`) | Path traversal, null-byte injection, symlink escape, absolute-path access, write/delete outside sandbox, permission-level gate |
| **TerminalTool** (`packages/tools/src/terminal.ts`) | Command allowlist enforcement, shell-injection via args, shell metacharacters in flags, empty command, permission-level gate |
| **Agent prompt injection** (not yet tested — see §4) | Injected content in agent rationale/narrative fields that causes tool misuse |
| **WebSocket approval flow** (not yet tested — see §4) | Replay attacks, race conditions in approve/deny sequencing |
| **Credential storage** (not yet tested — see §4) | API keys in env vars, DB connection strings at rest |

### Out of scope

- Network-layer attacks (DDoS, TLS stripping, BGP hijacking)
- Denial-of-service via resource exhaustion (CPU/memory bomb)
- Supply-chain attacks on npm dependencies
- Physical / insider-threat scenarios
- Cloud IAM misconfigurations outside the application boundary

---

## 2. Attack vectors tested

### 2.1 FilesystemTool — path traversal

**Test file:** `packages/tools/src/__tests__/red-team.test.ts`

| Test case | Input | Expected result |
|---|---|---|
| Classic traversal | `../../etc/passwd` | `success: false`, error matches `/traversal\|rejected/i` |
| Deep traversal | `../../../root/.ssh/id_rsa` | `success: false` |
| Sandbox-prefix traversal | `<sandboxRoot>/../../etc/shadow` | `success: false` |
| Absolute path | `/etc/passwd`, `/root/.bashrc` | `success: false` |
| Write outside sandbox | `../outside.txt` | `success: false`, file not created |
| Delete outside sandbox | `../../important.txt` | `success: false` |

**Mechanism tested:** `safePath()` in `FilesystemTool` uses `path.resolve` + `path.relative` to detect `..` prefixes in the relative path.

**Finding (low):** Symlink escapes are partially mitigated — `resolve()` follows symlinks so the resolved path lands outside the sandbox and is rejected. However, the tool does NOT call `fs.realpath()` before the `resolve` check; instead it relies on `resolve` not following symlinks at check time and the OS enforcing access at `readFileSync` time. This is safe on Linux but should be hardened with an explicit `fs.realpathSync` call before the relative-path check.

### 2.2 FilesystemTool — null-byte injection

**Test file:** `packages/tools/src/__tests__/red-team.test.ts`  
**Test:** `'rejects null-byte injected path'`

Node.js's `fs` module (since v7) throws `ERR_INVALID_ARG_VALUE` for paths containing null bytes, so the tool returns `success: false` via the catch block. The test asserts that even if somehow the call succeeded, the content returned must not match `/etc/passwd`.

### 2.3 TerminalTool — allowlist enforcement

**Test file:** `packages/tools/src/__tests__/red-team.test.ts`  
**Tests:** `'rejects command not on allowlist: bash'` (and `python3`, `curl`, `wget`, `rm`)

`validate()` checks `allowlist.includes(command)` before `execute()` spawns anything. Blocked commands never reach `child_process.spawn`.

### 2.4 TerminalTool — shell injection via args

**Test file:** `packages/tools/src/__tests__/red-team.test.ts`  
**Tests:** `'does not shell-expand injection in args'`, `'shell metacharacters in --format arg'`

`TerminalTool.execute()` calls `spawn(command, args, { shell: false })`. Shell metacharacters (`;`, `|`, `$()`, `` ` ``) are passed as literal bytes to the child process's `argv`, not interpreted by a shell. Tests confirm that `; rm -rf /` and `; echo INJECTED` do not execute as separate commands.

### 2.5 PermissionEngine — default deny

**Test file:** `packages/permissions/src/__tests__/red-team.test.ts`  
**Test:** `'returns allowed=false when no rules are configured'`

With an empty `permission_rules` table, `check()` iterates zero rules and returns `allowed: false`. This is the correct fail-closed posture.

### 2.6 PermissionEngine — role/tool/operation scoping

**Test file:** `packages/permissions/src/__tests__/red-team.test.ts`  
**Tests:** role-specific, tool-specific, operation-specific test groups

Rules are matched with three independent predicates (`roleMatch && toolMatch && opMatch`). Tests verify that a rule for `architect` does not grant `devil_advocate`, a rule for `filesystem` does not grant `terminal`, and a rule for `['read_file']` does not grant `write_file`.

### 2.7 PermissionEngine — approval gate bypass

**Test file:** `packages/permissions/src/__tests__/red-team.test.ts`  
**Tests:** `'check() returns allowed=false after request created but before approval'`

Creating a `permission_request` row (status=pending) does NOT insert into `permission_rules`. `check()` only queries `permission_rules`, so a pending request cannot be used to bypass the gate.

### 2.8 PermissionEngine — SQL/prompt injection in rationale

**Test file:** `packages/permissions/src/__tests__/red-team.test.ts`  
**Test:** `'stores SQL-injection rationale safely without corrupting DB state'`

The rationale `'; DROP TABLE permission_requests; --` is passed as a parameter to the Drizzle `insert().values()` call, which uses prepared statements. The string is stored verbatim as data and does not alter DB structure. Test confirms the request is still retrievable with the correct rationale value.

---

## 3. How to run the tests

### Prerequisites

```bash
# From repo root
pnpm install
```

### Running with node:test (no compile step needed)

```bash
# FilesystemTool + TerminalTool
node --experimental-strip-types --test \
  packages/tools/src/__tests__/red-team.test.ts

# PermissionEngine
node --experimental-strip-types --test \
  packages/permissions/src/__tests__/red-team.test.ts
```

### Running all tests

```bash
node --experimental-strip-types --test \
  'packages/*/src/__tests__/red-team.test.ts'
```

### CI integration (GitHub Actions)

Add to `.github/workflows/ci.yml`:

```yaml
- name: Red-team tests
  run: |
    node --experimental-strip-types --test \
      'packages/*/src/__tests__/red-team.test.ts'
```

---

## 4. Attack vectors NOT yet tested

These represent the highest-priority work items before expanding write access to production repositories.

### 4.1 Agent prompt injection causing tool misuse

**Risk:** An agent's `narrative` or `rationale` field (written by an LLM) contains instructions that cause a downstream agent or the orchestrator to call `FilesystemTool.execute` with an attacker-controlled path.

**Example:** Malicious content in a user-supplied task description that the architect agent reflects verbatim into a tool call's `path` field.

**Recommended test approach:** Unit-test the orchestrator's tool-call parsing to confirm it does not evaluate or interpolate any LLM output as code/paths before passing to `FilesystemTool.validate()`.

**Severity if exploited:** Critical — could lead to arbitrary file read/write within the sandbox.

### 4.2 WebSocket replay attacks on the approval flow

**Risk:** The `/approve` WebSocket message is captured and replayed to approve a different (malicious) `requestId` that was created by an attacker-controlled agent.

**Recommended test approach:** Integration test that sends an approval WS message with a mismatched `requestId`/`projectId` combination and asserts it is rejected. Verify the `resolveRequest` call checks that the request belongs to the authenticated project.

**Severity if exploited:** High — could grant unauthorized tool permissions.

### 4.3 Race condition in permission approval

**Risk:** Two concurrent `check()` calls bracket a `grantRule()` call; one might observe a partial DB write and return an incorrect result.

**Recommended test approach:** Stress test with `Promise.all` spawning 100 concurrent `check()` and `grantRule()` calls, asserting that no call returns `allowed: true` before the rule is fully committed.

**Severity if exploited:** Medium — intermittent false-positive grants under load.

### 4.4 Multi-agent collusion

**Risk:** Two agents with individually limited permissions combine their actions (e.g., `devil_advocate` reads sensitive config via `filesystem`, `architect` exfiltrates it via `terminal`) in a way that neither permission rule individually blocks.

**Recommended test approach:** End-to-end test that runs both agents against the same project and asserts the audit log contains no cross-agent data flow that bypasses the intent of the per-agent rules.

**Severity if exploited:** High — emergent capability not caught by per-agent checks.

### 4.5 Credential leakage via audit log

**Risk:** A tool call includes an API key or secret in the `input` field, which is passed to `context.auditLog()` and persisted to the DB in plaintext.

**Recommended test approach:** Assert that `auditLog` calls for `filesystem` and `terminal` do not include the `content` field of `write_file` operations or the environment variables of terminal commands.

**Severity if exploited:** High — secrets at rest in the audit log.

---

## 5. Acceptance criteria

All of the following must pass before expanding GitHub write access (`mcp__github__push_files`, `mcp__github__create_pull_request`) or enabling filesystem write access in production:

- [ ] All tests in `packages/tools/src/__tests__/red-team.test.ts` pass with exit code 0
- [ ] All tests in `packages/permissions/src/__tests__/red-team.test.ts` pass with exit code 0
- [ ] No test is marked `.skip` or `todo` without a linked issue
- [ ] CI runs both test files on every PR targeting `main`
- [ ] The four untested attack vectors (§4) each have a tracking issue created

---

## 6. Severity rating guide

| Severity | Definition | Examples from this codebase |
|---|---|---|
| **Critical** | Allows code execution or data exfiltration outside the sandbox with no user interaction | Successful path traversal to `/etc/passwd`; shell injection executing `rm -rf` |
| **High** | Allows privilege escalation within the permission model, or leaks secrets | Approval gate bypass; credential leak via audit log; WebSocket replay |
| **Medium** | Allows denial of service or intermittent policy bypass | Race condition in approval; resource exhaustion via large file write |
| **Low** | Defense-in-depth gap with no direct exploitability | Missing `realpathSync` hardening on symlinks; verbose error messages exposing sandbox path |
| **Info** | Best-practice deviation with negligible risk in current architecture | Audit log stores tool input verbatim (no PII risk currently) |

Any finding rated **High** or **Critical** blocks the relevant feature expansion until remediated and re-tested.
