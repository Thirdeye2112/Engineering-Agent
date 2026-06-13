import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export interface InterventionEvent {
  toolOp: string;
  requestId: string;
  decision: 'approved' | 'denied' | 'unexpected';
  timestampMs: number;
}

export interface ActionEvent {
  type: string;
  timestampMs: number;
}

/**
 * Tracks every agent action and human intervention point during a pilot run.
 * Computes the intervention percentage at the end.
 */
export class InterventionTracker {
  private allowedGates: Set<string>;
  private interventions: InterventionEvent[] = [];
  private actions: ActionEvent[] = [];
  private unexpectedGates: string[] = [];
  private startMs = Date.now();
  private rl: ReturnType<typeof readline.createInterface> | null = null;

  constructor(allowedGates: string[]) {
    this.allowedGates = new Set(allowedGates);
  }

  isAllowedGate(toolOp: string): boolean {
    return this.allowedGates.has(toolOp);
  }

  recordAction(type = 'tool_call') {
    this.actions.push({ type, timestampMs: Date.now() });
  }

  recordAutoAction(type: string) {
    this.actions.push({ type, timestampMs: Date.now() });
  }

  recordInterventionRequest(toolOp: string, requestId: string) {
    // The request itself is an action
    this.actions.push({ type: `gate_request:${toolOp}`, timestampMs: Date.now() });
  }

  recordApproved(requestId: string, toolOp = '') {
    this.interventions.push({ toolOp, requestId, decision: 'approved', timestampMs: Date.now() });
  }

  recordDenied(requestId: string, toolOp = '') {
    this.interventions.push({ toolOp, requestId, decision: 'denied', timestampMs: Date.now() });
  }

  recordUnexpected(toolOp: string) {
    this.unexpectedGates.push(toolOp);
    this.interventions.push({ toolOp, requestId: '', decision: 'unexpected', timestampMs: Date.now() });
  }

  /** Prompt the user interactively for a gate decision. Returns true = approved. */
  async promptHuman(toolOp: string, rationale: string): Promise<boolean> {
    if (!this.rl) {
      this.rl = readline.createInterface({ input: stdin, output: stdout });
    }
    console.log('\n┌─────────────────────────────────────────────────────┐');
    console.log(`│  🔐 Human gate: ${toolOp.padEnd(35)}│`);
    console.log('├─────────────────────────────────────────────────────┤');
    console.log(`│  ${rationale.slice(0, 51).padEnd(51)}│`);
    console.log('└─────────────────────────────────────────────────────┘');
    const answer = await this.rl.question('  Approve? [Y/n] ');
    return answer.trim().toLowerCase() !== 'n';
  }

  closePrompt() {
    this.rl?.close();
    this.rl = null;
  }

  get totalActions(): number {
    return this.actions.length;
  }

  get totalInterventions(): number {
    return this.interventions.filter(i => i.decision !== 'unexpected').length;
  }

  get interventionPct(): number {
    const total = this.totalActions + this.totalInterventions;
    if (total === 0) return 0;
    return (this.totalInterventions / total) * 100;
  }

  get elapsedMs(): number {
    return Date.now() - this.startMs;
  }

  get summary() {
    return {
      totalActions: this.totalActions,
      humanInterventions: this.totalInterventions,
      interventionPct: Math.round(this.interventionPct * 10) / 10,
      approvedGates: this.interventions.filter(i => i.decision === 'approved').map(i => i.toolOp),
      deniedGates: this.interventions.filter(i => i.decision === 'denied').map(i => i.toolOp),
      unexpectedGates: this.unexpectedGates,
      elapsedMs: this.elapsedMs,
      underThreshold: this.interventionPct <= 20,
    };
  }
}
