import type { Report } from './components/ReportView';

const BASE = '/api';

export interface Project {
  id: string;
  task: string;
  mode: string;
  status: string;
  config: unknown;
  report: Report | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateProjectPayload {
  task: string;
  mode: 'debate' | 'collaborate' | 'pr_workflow';
  agents: Array<{ provider: string; tier: string; role: string }>;
  maxRounds: number;
  budgetCap?: number;
}

export async function fetchProjects(): Promise<Project[]> {
  const resp = await fetch(`${BASE}/projects`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchProject(id: string): Promise<Project> {
  const resp = await fetch(`${BASE}/projects/${id}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createProject(payload: CreateProjectPayload): Promise<{ projectId: string }> {
  const resp = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(JSON.stringify(err));
  }
  return resp.json();
}

export function openProjectSocket(projectId: string, onEvent: (e: unknown) => void): WebSocket {
  const wsBase = window.location.hostname === 'localhost'
    ? 'ws://localhost:3000'
    : `ws://${window.location.host}`;
  const ws = new WebSocket(`${wsBase}?projectId=${projectId}`);
  ws.onmessage = (msg) => { try { onEvent(JSON.parse(msg.data)); } catch { /* ignore */ } };
  return ws;
}

export interface PendingApprovalItem {
  id: string;
  projectId: string;
  agentRole: string;
  tool: string;
  operation: string;
  rationale: string;
  status: string;
  createdAt: string;
}

export async function fetchPendingApprovals(): Promise<PendingApprovalItem[]> {
  const resp = await fetch(`${BASE}/approvals/pending`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function approveRequest(id: string): Promise<void> {
  const resp = await fetch(`${BASE}/approvals/${id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewedBy: 'human' }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export async function denyRequest(id: string): Promise<void> {
  const resp = await fetch(`${BASE}/approvals/${id}/deny`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewedBy: 'human' }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  category: string;
  title: string;
  content: string;
  sourceType: string;
  confidence: number;
  createdAt: string;
  expiresAt?: string;
  supersededBy?: string;
}

export async function fetchProjectMemories(projectId: string): Promise<MemoryRecord[]> {
  const resp = await fetch(`${BASE}/projects/${projectId}/memories`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface AuditVerifyResult {
  valid: boolean;
  firstInvalidId?: string;
  checkedCount: number;
}

export async function verifyAuditChain(projectId?: string): Promise<AuditVerifyResult> {
  const url = projectId ? `${BASE}/audit/verify?projectId=${projectId}` : `${BASE}/audit/verify`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface AuditEvent {
  id: string;
  projectId?: string;
  actorType: string;
  actorId?: string;
  actionType: string;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  approvalStatus?: string;
  eventHash: string;
  previousEventHash: string;
  createdAt: string;
}

export async function fetchAuditEvents(projectId: string, limit = 100): Promise<AuditEvent[]> {
  const resp = await fetch(`${BASE}/projects/${projectId}/audit-events?limit=${limit}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface ApprovalMetricRow {
  agentRole?: string;
  toolName?: string;
  approved: number;
  denied: number;
  autoAllowed: number;
  total: number;
  approvalRate: number;
}

export interface ApprovalMetrics {
  rows: ApprovalMetricRow[];
  globalApprovalRate: number;
  totalDecisions: number;
  highTrustAgents: string[];
}

export async function fetchApprovalMetrics(projectId?: string): Promise<ApprovalMetrics> {
  const url = projectId ? `${BASE}/metrics/approvals?projectId=${projectId}` : `${BASE}/metrics/approvals`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface OnboardingReport {
  projectId: string;
  repoFullName?: string;
  packageManager: string;
  isMonorepo: boolean;
  frameworks: string[];
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  hasTypeScript: boolean;
  hasCiConfig: boolean;
  memoriesWritten: number;
  permissionRulesCreated: number;
  completedAt: string;
}

export async function onboardProject(projectId: string, sandboxRoot: string, repoFullName?: string): Promise<OnboardingReport> {
  const resp = await fetch(`${BASE}/projects/${projectId}/onboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sandboxRoot, repoFullName }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(JSON.stringify(err));
  }
  return resp.json();
}
