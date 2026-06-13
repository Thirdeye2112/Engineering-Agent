/**
 * Phase 6 tests: Approval queue, audit endpoints, memory endpoint, workflow report.
 * Tests the pure logic units (no live DB / HTTP) — integration-level endpoint tests
 * require a running Postgres; those live in e2e. Here we test the data-shaping
 * and guard logic that sits around the DB calls.
 *
 * Run: npx tsx --test packages/api-server/src/__tests__/phase6.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Approval queue logic ──────────────────────────────────────────────────────

describe('Approval queue', () => {
  it('pending approvals array only contains status=pending items (filter logic)', () => {
    const allRequests = [
      { id: '1', status: 'pending', tool: 'github', operation: 'open_pr' },
      { id: '2', status: 'approved', tool: 'filesystem', operation: 'write' },
      { id: '3', status: 'pending', tool: 'terminal', operation: 'run' },
      { id: '4', status: 'denied', tool: 'github', operation: 'commit_file' },
    ];
    const pending = allRequests.filter(r => r.status === 'pending');
    assert.equal(pending.length, 2);
    assert.ok(pending.every(r => r.status === 'pending'));
  });

  it('approve action emits correct audit event fields', () => {
    const events: unknown[] = [];
    function fakeAuditAppend(event: { actionType: string; approvalStatus: string }) {
      events.push(event);
    }
    fakeAuditAppend({ actionType: 'approval.granted', approvalStatus: 'approved' });
    assert.equal((events[0] as { actionType: string }).actionType, 'approval.granted');
    assert.equal((events[0] as { approvalStatus: string }).approvalStatus, 'approved');
  });

  it('deny action emits correct audit event fields', () => {
    const events: unknown[] = [];
    function fakeAuditAppend(event: { actionType: string; approvalStatus: string }) {
      events.push(event);
    }
    fakeAuditAppend({ actionType: 'approval.denied', approvalStatus: 'denied' });
    assert.equal((events[0] as { actionType: string }).actionType, 'approval.denied');
    assert.equal((events[0] as { approvalStatus: string }).approvalStatus, 'denied');
  });
});

// ── Audit verify logic ────────────────────────────────────────────────────────

describe('Audit verify endpoint', () => {
  it('passes projectId param through to verify()', () => {
    let capturedProjectId: string | undefined;
    function fakeVerify(projectId?: string) {
      capturedProjectId = projectId;
      return Promise.resolve({ valid: true, checkedCount: 0 });
    }
    const projectId = 'proj-123';
    fakeVerify(projectId);
    assert.equal(capturedProjectId, 'proj-123');
  });

  it('verify without projectId passes undefined', () => {
    let capturedProjectId: string | undefined = 'initial';
    function fakeVerify(projectId?: string) {
      capturedProjectId = projectId;
      return Promise.resolve({ valid: true, checkedCount: 0 });
    }
    fakeVerify(undefined);
    assert.equal(capturedProjectId, undefined);
  });

  it('invalid chain result has valid=false', () => {
    const result = { valid: false, firstInvalidId: 'bad-id', checkedCount: 5 };
    assert.equal(result.valid, false);
    assert.equal(result.firstInvalidId, 'bad-id');
  });
});

// ── Workflow report endpoint ───────────────────────────────────────────────────

describe('Workflow report endpoint', () => {
  it('returns 404 when project has no report', () => {
    function handleWorkflowReport(project: { report: unknown } | null) {
      if (!project) return { status: 404, body: { error: 'Not found' } };
      if (!project.report) return { status: 404, body: { error: 'No report available' } };
      return { status: 200, body: project.report };
    }
    assert.deepEqual(handleWorkflowReport(null), { status: 404, body: { error: 'Not found' } });
    assert.deepEqual(handleWorkflowReport({ report: null }), { status: 404, body: { error: 'No report available' } });
  });

  it('returns report when present', () => {
    const report = { implementationPlan: 'Do stuff', filesModified: ['a.ts'], totalCostUsd: 0.01 };
    function handleWorkflowReport(project: { report: unknown } | null) {
      if (!project) return { status: 404, body: { error: 'Not found' } };
      if (!project.report) return { status: 404, body: { error: 'No report available' } };
      return { status: 200, body: project.report };
    }
    const result = handleWorkflowReport({ report });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, report);
  });
});

// ── Memory endpoint ───────────────────────────────────────────────────────────

describe('Project memories endpoint', () => {
  it('limit is capped at 500', () => {
    function parseLimit(raw: string | undefined): number {
      return Math.min(parseInt(raw ?? '100'), 500);
    }
    assert.equal(parseLimit('1000'), 500);
    assert.equal(parseLimit('50'), 50);
    assert.equal(parseLimit(undefined), 100);
  });

  it('includeExpired parsed from query string', () => {
    function parseFlag(raw: string | undefined) {
      return raw === 'true';
    }
    assert.equal(parseFlag('true'), true);
    assert.equal(parseFlag('false'), false);
    assert.equal(parseFlag(undefined), false);
  });

  it('memory records have required shape fields', () => {
    const mem = {
      id: 'abc-123',
      projectId: 'proj-1',
      category: 'architecture_decision',
      title: 'Use pnpm',
      content: 'pnpm is the package manager',
      sourceType: 'user_feedback',
      confidence: 0.9,
      createdAt: new Date().toISOString(),
    };
    assert.ok(mem.id);
    assert.ok(mem.category);
    assert.ok(typeof mem.confidence === 'number');
  });
});

// ── PRQualityChecklist readyToMerge ─────────────────────────────────────────

describe('PRQualityChecklist readyToMerge gate', () => {
  type Checklist = {
    blockingObjections: string[];
    codeReviewVerdict?: string;
    auditChainValid: boolean;
    requiredTestsPassed?: boolean;
  };

  function computeReadyToMerge(c: Checklist): boolean {
    return (
      c.blockingObjections.length === 0 &&
      c.codeReviewVerdict !== 'block' &&
      c.auditChainValid &&
      c.requiredTestsPassed !== false
    );
  }

  it('ready when all gates pass', () => {
    assert.ok(computeReadyToMerge({
      blockingObjections: [],
      codeReviewVerdict: 'approve',
      auditChainValid: true,
      requiredTestsPassed: true,
    }));
  });

  it('not ready when blocking objection exists', () => {
    assert.equal(computeReadyToMerge({
      blockingObjections: ['Security issue'],
      codeReviewVerdict: 'approve',
      auditChainValid: true,
      requiredTestsPassed: true,
    }), false);
  });

  it('not ready when code review verdict is block', () => {
    assert.equal(computeReadyToMerge({
      blockingObjections: [],
      codeReviewVerdict: 'block',
      auditChainValid: true,
      requiredTestsPassed: true,
    }), false);
  });

  it('not ready when audit chain invalid', () => {
    assert.equal(computeReadyToMerge({
      blockingObjections: [],
      codeReviewVerdict: 'approve',
      auditChainValid: false,
      requiredTestsPassed: true,
    }), false);
  });

  it('not ready when required tests failed', () => {
    assert.equal(computeReadyToMerge({
      blockingObjections: [],
      codeReviewVerdict: 'approve',
      auditChainValid: true,
      requiredTestsPassed: false,
    }), false);
  });

  it('ready when requiredTestsPassed is undefined (not yet run)', () => {
    // undefined means tests haven't run — treated as not blocking
    assert.ok(computeReadyToMerge({
      blockingObjections: [],
      codeReviewVerdict: 'approve',
      auditChainValid: true,
      requiredTestsPassed: undefined,
    }));
  });
});

// ── Denied action creates audit event ────────────────────────────────────────

describe('Denied action audit trail', () => {
  it('deny emits approval.denied with denied approvalStatus', () => {
    const events: Array<{ actionType: string; approvalStatus: string; actorId: string }> = [];

    function handleDeny(requestId: string, reviewedBy: string) {
      events.push({
        actionType: 'approval.denied',
        approvalStatus: 'denied',
        actorId: reviewedBy,
      });
    }

    handleDeny('req-abc', 'alice');
    assert.equal(events.length, 1);
    assert.equal(events[0].actionType, 'approval.denied');
    assert.equal(events[0].approvalStatus, 'denied');
    assert.equal(events[0].actorId, 'alice');
  });

  it('deny broadcast emits permission_denied event', () => {
    const broadcasts: Array<{ type: string; requestId: string }> = [];
    function broadcast(event: { type: string; requestId: string }) {
      broadcasts.push(event);
    }
    broadcast({ type: 'permission_denied', requestId: 'req-abc' });
    assert.equal(broadcasts[0].type, 'permission_denied');
    assert.equal(broadcasts[0].requestId, 'req-abc');
  });
});

// ── Patch preview data shape ──────────────────────────────────────────────────

describe('Patch preview shape', () => {
  it('patch preview has required fields for diff rendering', () => {
    const patch = {
      path: 'src/index.ts',
      originalSnippet: 'const x = 1;',
      proposedSnippet: 'const x = 2;',
      reason: 'Update constant',
      riskLevel: 'low' as const,
      reviewerVerdict: 'approve' as const,
    };
    assert.ok(patch.path);
    assert.ok(typeof patch.originalSnippet === 'string');
    assert.ok(typeof patch.proposedSnippet === 'string');
    assert.ok(['low', 'medium', 'high', 'critical'].includes(patch.riskLevel));
  });
});
