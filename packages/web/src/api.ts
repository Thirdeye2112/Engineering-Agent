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
