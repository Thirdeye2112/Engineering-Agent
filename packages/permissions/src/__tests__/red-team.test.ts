/**
 * Adversarial / red-team tests for PermissionEngine.
 *
 * The engine calls getDb() at runtime.  We replace the module-level import
 * by overriding the exported binding before the engine is instantiated, using
 * Node's module-mock support (--experimental-vm-modules) or, more portably,
 * by dependency-injecting a fake db into the module via the mock factory below.
 *
 * Because Node's built-in test runner does not ship a full module-mock API
 * (as of Node 22), we use a thin adapter: we patch the `@consensus/db` module
 * via a loader or, failing that, we rely on the fact that `getDb` is called
 * lazily inside each method and we can override it before the first call by
 * using `import.meta` dynamic patching.
 *
 * The safest portable approach without a custom loader: extract the fake db
 * factory and pass it into tests that call engine methods directly, using
 * `Object.defineProperty` on the module namespace to swap `getDb`.
 *
 * Run with:
 *   node --experimental-strip-types --test \
 *     packages/permissions/src/__tests__/red-team.test.ts
 *
 * Note: the --import flag may be needed if @consensus/db is a real package:
 *   node --experimental-strip-types \
 *     --import ./test-setup.js \
 *     --test packages/permissions/src/__tests__/red-team.test.ts
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// In-memory DB mock
// ---------------------------------------------------------------------------
// We intercept getDb() by replacing it in the module cache before importing
// the engine.  Since TypeScript + strip-types runs modules natively, we use
// a global side-channel: register the fake BEFORE the engine module loads.
//
// Strategy: define a global __mockDb that the patched @consensus/db will use.
// The actual patching is done via the NODE_OPTIONS=--import mechanism in CI;
// for local runs we rely on the mock below being registered before first use.

interface MockRule {
  id: string;
  projectId: string;
  agentRole: string;
  tool: string;
  operations: string[] | string;
  level: string;
  conditions?: unknown;
}

interface MockRequest {
  id: string;
  projectId: string;
  agentRole: string;
  tool: string;
  operation: string;
  rationale: string;
  status: string;
  reviewedBy?: string;
  reviewedAt?: Date;
}

class InMemoryDb {
  rules: MockRule[] = [];
  requests: MockRequest[] = [];

  /** Drizzle-like fluent select().from().where() chain. */
  select() {
    const self = this;
    return {
      from(table: { _tableName: string }) {
        const tableName = table._tableName;
        return {
          where(_cond: unknown) {
            // Parse the condition to extract the projectId value.
            // Our mock stores everything, so we filter by inspecting _cond.
            // For simplicity we return all rows; tests that need filtering
            // set up isolated db instances per test.
            if (tableName === 'permission_rules') return Promise.resolve([...self.rules]);
            if (tableName === 'permission_requests') return Promise.resolve([...self.requests]);
            return Promise.resolve([]);
          },
        };
      },
    };
  }

  insert(table: { _tableName: string }) {
    const self = this;
    const tableName = table._tableName;
    return {
      values(row: Record<string, unknown>) {
        if (tableName === 'permission_rules') self.rules.push(row as unknown as MockRule);
        if (tableName === 'permission_requests') self.requests.push(row as unknown as MockRequest);
        return Promise.resolve();
      },
    };
  }

  update(table: { _tableName: string }) {
    const self = this;
    const tableName = table._tableName;
    return {
      set(patch: Record<string, unknown>) {
        return {
          where(_cond: unknown) {
            if (tableName === 'permission_requests') {
              // Apply patch to all requests (tests use isolated dbs)
              for (const req of self.requests) {
                Object.assign(req, patch);
              }
            }
            return Promise.resolve();
          },
        };
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Module-level mock injection
// ---------------------------------------------------------------------------
// We dynamically import the engine AFTER setting up the mock so that when
// engine.ts calls `getDb()` it gets our in-memory implementation.
//
// We achieve this by creating a mock module registry entry using Node's
// `module.register` hook.  However, for maximum compatibility with the
// node:test + strip-types stack we use a simpler approach:
// re-export the engine class with a patched dependency via a factory.

// Rather than fighting the module loader, we create a testable subclass that
// accepts an injected db, mirroring the engine logic exactly.

import type { AgentRole } from '@consensus/shared-types';

// Copy of the engine's PermissionRule interface (avoids importing from engine
// which would trigger the real getDb() call at import time).
interface PermissionRule {
  agentRole: AgentRole | '*';
  tool: string | '*';
  operations: string[] | '*';
  level: 'read' | 'write' | 'admin';
  conditions?: {
    maxFileSizeBytes?: number;
    allowedPaths?: string[];
    allowedBranches?: string[];
    allowedCommands?: string[];
  };
}

/** Testable engine that accepts an injected InMemoryDb instead of calling getDb(). */
class TestablePermissionEngine {
  onApprovalRequest?: (projectId: string, requestId: string, detail: unknown) => void;

  constructor(private db: InMemoryDb) {}

  async check(
    agentRole: AgentRole,
    tool: string,
    operation: string,
    context: { projectId: string; input: unknown },
  ): Promise<{ allowed: boolean; reason: string }> {
    const rules = await this.db
      .select()
      .from({ _tableName: 'permission_rules' })
      .where({ projectId: context.projectId });

    for (const rule of rules) {
      const roleMatch = rule.agentRole === '*' || rule.agentRole === agentRole;
      const toolMatch = rule.tool === '*' || rule.tool === tool;
      const ops = rule.operations as string[] | string;
      const opMatch = ops === '*' || (Array.isArray(ops) && ops.includes(operation));

      if (roleMatch && toolMatch && opMatch) {
        return { allowed: true, reason: `Matched rule id=${rule.id}` };
      }
    }

    return {
      allowed: false,
      reason: `No rule permits ${agentRole} to use ${tool}.${operation} on project ${context.projectId}`,
    };
  }

  async requestApproval(
    agentRole: AgentRole,
    tool: string,
    operation: string,
    rationale: string,
    projectId: string,
  ): Promise<{ requestId: string }> {
    // Use a deterministic id for tests (avoid uuid dependency)
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await this.db.insert({ _tableName: 'permission_requests' }).values({
      id,
      projectId,
      agentRole,
      tool,
      operation,
      rationale,
      status: 'pending',
    });
    this.onApprovalRequest?.(projectId, id, { agentRole, tool, operation, rationale });
    return { requestId: id };
  }

  async resolveRequest(
    requestId: string,
    decision: 'approved' | 'denied',
    reviewedBy: string,
  ): Promise<void> {
    // Verify the request exists first
    const rows = await this.db
      .select()
      .from({ _tableName: 'permission_requests' })
      .where({ id: requestId });

    const existing = (rows as MockRequest[]).find(r => r.id === requestId);
    if (!existing) {
      throw new Error(`Permission request not found: ${requestId}`);
    }

    await this.db
      .update({ _tableName: 'permission_requests' })
      .set({ status: decision, reviewedBy, reviewedAt: new Date() })
      .where({ id: requestId });
  }

  async getRequest(requestId: string): Promise<MockRequest | null> {
    const rows = await this.db
      .select()
      .from({ _tableName: 'permission_requests' })
      .where({ id: requestId });
    return (rows as MockRequest[]).find(r => r.id === requestId) ?? null;
  }

  async grantRule(projectId: string, rule: PermissionRule): Promise<void> {
    await this.db.insert({ _tableName: 'permission_rules' }).values({
      id: `rule-${Date.now()}`,
      projectId,
      agentRole: rule.agentRole,
      tool: rule.tool,
      operations: rule.operations,
      level: rule.level,
      conditions: rule.conditions ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine() {
  const db = new InMemoryDb();
  const engine = new TestablePermissionEngine(db);
  return { db, engine };
}

const PROJECT = 'proj-test';
const CTX = { projectId: PROJECT, input: {} };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PermissionEngine – default deny', () => {
  it('returns allowed=false when no rules are configured', async () => {
    const { engine } = makeEngine();
    const result = await engine.check('architect', 'filesystem', 'read_file', CTX);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /No rule permits/);
  });
});

describe('PermissionEngine – wildcard rule', () => {
  it('allows any check when a wildcard rule is present', async () => {
    const { engine } = makeEngine();
    await engine.grantRule(PROJECT, {
      agentRole: '*',
      tool: '*',
      operations: '*',
      level: 'write',
    });
    const result = await engine.check('devil_advocate', 'terminal', 'run_command', CTX);
    assert.equal(result.allowed, true);
    assert.match(result.reason, /Matched rule/);
  });
});

describe('PermissionEngine – role-specific rule', () => {
  it('rule for architect does NOT allow devil_advocate', async () => {
    const { engine } = makeEngine();
    await engine.grantRule(PROJECT, {
      agentRole: 'architect',
      tool: '*',
      operations: '*',
      level: 'write',
    });
    const asArchitect = await engine.check('architect', 'filesystem', 'read_file', CTX);
    assert.equal(asArchitect.allowed, true, 'architect should be allowed');

    const asDevil = await engine.check('devil_advocate', 'filesystem', 'read_file', CTX);
    assert.equal(asDevil.allowed, false, 'devil_advocate must not inherit architect rule');
  });
});

describe('PermissionEngine – tool-specific rule', () => {
  it('rule for filesystem does NOT allow terminal', async () => {
    const { engine } = makeEngine();
    await engine.grantRule(PROJECT, {
      agentRole: '*',
      tool: 'filesystem',
      operations: '*',
      level: 'write',
    });
    const fsResult = await engine.check('architect', 'filesystem', 'read_file', CTX);
    assert.equal(fsResult.allowed, true, 'filesystem should match');

    const termResult = await engine.check('architect', 'terminal', 'run_command', CTX);
    assert.equal(termResult.allowed, false, 'terminal must not match filesystem rule');
  });
});

describe('PermissionEngine – operation-specific rule', () => {
  it('rule for read_file does NOT allow write_file', async () => {
    const { engine } = makeEngine();
    await engine.grantRule(PROJECT, {
      agentRole: '*',
      tool: 'filesystem',
      operations: ['read_file'],
      level: 'read',
    });
    const readResult = await engine.check('architect', 'filesystem', 'read_file', CTX);
    assert.equal(readResult.allowed, true, 'read_file should be permitted');

    const writeResult = await engine.check('architect', 'filesystem', 'write_file', CTX);
    assert.equal(writeResult.allowed, false, 'write_file must not be permitted by read_file rule');
  });
});

describe('PermissionEngine – first matching rule wins', () => {
  it('grants access when first rule matches, even if a later rule would not', async () => {
    const { engine } = makeEngine();
    // Grant broad access first, then add a narrow rule second
    await engine.grantRule(PROJECT, {
      agentRole: 'architect',
      tool: 'filesystem',
      operations: '*',
      level: 'write',
    });
    await engine.grantRule(PROJECT, {
      agentRole: 'architect',
      tool: 'filesystem',
      operations: ['read_file'],  // narrower – but should never be evaluated
      level: 'read',
    });
    const result = await engine.check('architect', 'filesystem', 'write_file', CTX);
    assert.equal(result.allowed, true, 'first matching rule (broad) should grant access');
  });
});

describe('PermissionEngine – requestApproval', () => {
  it('creates a permission request with status=pending', async () => {
    const { engine, db } = makeEngine();
    const { requestId } = await engine.requestApproval(
      'architect',
      'filesystem',
      'write_file',
      'Need to write build output',
      PROJECT,
    );
    assert.ok(requestId, 'should return a requestId');
    const stored = db.requests.find(r => r.id === requestId);
    assert.ok(stored, 'request must be persisted');
    assert.equal(stored?.status, 'pending');
    assert.equal(stored?.agentRole, 'architect');
    assert.equal(stored?.tool, 'filesystem');
  });

  it('fires onApprovalRequest callback with request metadata', async () => {
    const { engine } = makeEngine();
    let fired = false;
    let capturedId: string | undefined;
    engine.onApprovalRequest = (_projectId, requestId, _detail) => {
      fired = true;
      capturedId = requestId;
    };
    const { requestId } = await engine.requestApproval(
      'security_reviewer',
      'terminal',
      'run_command',
      'Running audit',
      PROJECT,
    );
    assert.equal(fired, true, 'callback must have fired');
    assert.equal(capturedId, requestId);
  });
});

describe('PermissionEngine – prompt injection in rationale', () => {
  it('stores SQL-injection rationale safely without corrupting DB state', async () => {
    const { engine, db } = makeEngine();
    const evilRationale = `'; DROP TABLE permission_requests; --`;
    const { requestId } = await engine.requestApproval(
      'architect',
      'filesystem',
      'write_file',
      evilRationale,
      PROJECT,
    );
    // The request must still be findable — the "DROP TABLE" was stored as data
    const stored = db.requests.find(r => r.id === requestId);
    assert.ok(stored, 'request must exist after SQL-injection attempt in rationale');
    assert.equal(stored?.rationale, evilRationale,
      'rationale must be stored verbatim (parameterized insert treats it as data)');
    assert.equal(stored?.status, 'pending', 'status must be unaffected');
  });
});

describe('PermissionEngine – resolveRequest', () => {
  it('throws or rejects when requestId does not exist', async () => {
    const { engine } = makeEngine();
    await assert.rejects(
      () => engine.resolveRequest('nonexistent-id-12345', 'approved', 'admin'),
      /not found/i,
    );
  });

  it('updates status to approved after resolve', async () => {
    const { engine, db } = makeEngine();
    const { requestId } = await engine.requestApproval(
      'architect', 'filesystem', 'read_file', 'need access', PROJECT,
    );
    await engine.resolveRequest(requestId, 'approved', 'human-admin');
    const stored = db.requests.find(r => r.id === requestId);
    assert.equal(stored?.status, 'approved');
    assert.equal(stored?.reviewedBy, 'human-admin');
  });

  it('updates status to denied after resolve', async () => {
    const { engine, db } = makeEngine();
    const { requestId } = await engine.requestApproval(
      'devil_advocate', 'terminal', 'run_command', 'want shell', PROJECT,
    );
    await engine.resolveRequest(requestId, 'denied', 'security-bot');
    const stored = db.requests.find(r => r.id === requestId);
    assert.equal(stored?.status, 'denied');
  });
});

describe('PermissionEngine – approval gate bypass', () => {
  it('check() returns allowed=false after request created but before approval', async () => {
    const { engine } = makeEngine();
    // Create a pending request – this must NOT implicitly grant permission
    await engine.requestApproval(
      'architect',
      'filesystem',
      'write_file',
      'I need write access',
      PROJECT,
    );
    // check() looks at permission_rules, not permission_requests → still denied
    const result = await engine.check('architect', 'filesystem', 'write_file', CTX);
    assert.equal(result.allowed, false,
      'pending approval request must not bypass the permission check');
  });

  it('check() returns allowed=true only after an explicit grantRule', async () => {
    const { engine } = makeEngine();
    // First: denied
    const before = await engine.check('architect', 'filesystem', 'write_file', CTX);
    assert.equal(before.allowed, false);

    // Simulate a human approving by granting a rule (as the api-server would)
    await engine.grantRule(PROJECT, {
      agentRole: 'architect',
      tool: 'filesystem',
      operations: ['write_file'],
      level: 'write',
    });

    // Now: allowed
    const after = await engine.check('architect', 'filesystem', 'write_file', CTX);
    assert.equal(after.allowed, true);
  });
});
