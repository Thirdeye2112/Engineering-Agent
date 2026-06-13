export interface AgentProposal {
  recommendation: string;
  reasoning: string[];
  assumptions: string[];
  risks: string[];
  confidence: number;
}

export interface AgentPosition {
  agentRole: string;
  provider: string;
  proposal: AgentProposal;
  riskFlags: Array<{ severity: string; description: string }>;
  finalVote?: { vote: string; rationale: string };
}

export interface Report {
  // Debate mode
  rounds?: number;
  positions?: AgentPosition[];
  consensus?: { reached: boolean; recommendation: string; dissent: string[]; blockingObjections: string[] };
  riskSummary?: Array<{ severity: string; description: string; raisedBy: string }>;
  totalCostUsd: number;
  // Collaboration mode
  integratedDocument?: string;
  results?: Array<{ subtaskId: string; agentRole: string; deliverable: string; concerns: string[] }>;
  // PR workflow mode
  implementationPlan?: string;
  prUrl?: string;
  prNumber?: number;
  branch?: string;
  filesModified?: string[];
  blockingObjections?: string[];
  securityReview?: {
    approved: boolean;
    findings: Array<{ severity: string; description: string; file?: string }>;
    blockingIssues: string[];
    recommendation: string;
  };
  steps?: Array<{
    iteration: number;
    narrative: string;
    toolCalls: Array<{ tool: string; operation: string; [key: string]: unknown }>;
    toolResults: Array<{ tool: string; success: boolean; output: unknown; error?: string }>;
  }>;
}

function SeverityDot({ s }: { s: string }) {
  const colors: Record<string, string> = { low: '#22c55e', medium: '#eab308', high: '#f97316', critical: '#ef4444' };
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors[s] ?? '#888', display: 'inline-block', flexShrink: 0 }} />;
}

function PRWorkflowReportView({ report }: { report: Report }) {
  const secReview = report.securityReview;
  return (
    <div>
      {report.prUrl ? (
        <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 24 }}>🔀</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Pull Request Opened</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {report.branch} · {report.filesModified?.length ?? 0} files modified
            </div>
          </div>
          <a href={report.prUrl} target="_blank" rel="noreferrer" className="btn-primary" style={{ textDecoration: 'none', fontSize: 13 }}>
            View PR #{report.prNumber} ↗
          </a>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'var(--yellow)', marginBottom: 20 }}>
          <p style={{ color: 'var(--yellow)', fontWeight: 600 }}>No PR opened</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            The agent did not complete the PR creation step.
            {(report.blockingObjections?.length ?? 0) > 0 ? ` Blocking: ${report.blockingObjections!.join('; ')}` : ''}
          </p>
        </div>
      )}

      {(report.blockingObjections?.length ?? 0) > 0 && (
        <div className="report-section">
          <h3>Blocking Objections</h3>
          <div className="card" style={{ borderColor: 'var(--red)' }}>
            {report.blockingObjections!.map((o, i) => (
              <div key={i} className="risk-item" style={{ background: 'rgba(239,68,68,0.1)', marginBottom: 6 }}>{o}</div>
            ))}
          </div>
        </div>
      )}

      {secReview && (
        <div className="report-section">
          <h3>Security Review</h3>
          <div className="card" style={{ borderColor: secReview.approved ? 'var(--green)' : 'var(--red)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className={`tag ${secReview.approved ? 'tag-complete' : 'tag-error'}`}>
                {secReview.approved ? '✓ Approved' : '✗ Rejected'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{secReview.recommendation}</span>
            </div>
            {secReview.findings.map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <SeverityDot s={f.severity} />
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{f.severity}</span>
                  {f.file && <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 6 }}>{f.file}</span>}
                  {' — '}
                  <span style={{ fontSize: 13 }}>{f.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.implementationPlan && (
        <div className="report-section">
          <h3>Implementation Plan</h3>
          <div className="card">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}>
              {report.implementationPlan}
            </pre>
          </div>
        </div>
      )}

      {(report.steps?.length ?? 0) > 0 && (
        <div className="report-section">
          <h3>Implementation Steps</h3>
          {report.steps!.map((step, i) => (
            <div key={i} className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Step {step.iteration + 1}</div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>{step.narrative}</p>
              {step.toolCalls.map((tc, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, fontSize: 12, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
                  <span style={{ color: step.toolResults[j]?.success ? 'var(--green)' : 'var(--red)' }}>
                    {step.toolResults[j]?.success ? '✓' : '✗'}
                  </span>
                  <span style={{ color: 'var(--accent)' }}>{tc.tool}</span>
                  <span style={{ color: 'var(--text-muted)' }}>.</span>
                  <span>{tc.operation}</span>
                  {typeof tc['path'] === 'string' && <span style={{ color: 'var(--text-muted)' }}>{tc['path']}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
        Total cost: ${report.totalCostUsd.toFixed(4)}
      </div>
    </div>
  );
}

export default function ReportView({ report }: { report: Report }) {
  // PR workflow mode
  if (report.implementationPlan !== undefined || (report.steps !== undefined && report.steps.length > 0)) {
    return <PRWorkflowReportView report={report} />;
  }

  // Collaboration mode
  if (report.integratedDocument) {
    return (
      <div>
        <div className="report-section">
          <h3>Integrated Document</h3>
          <div className="card">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}>
              {report.integratedDocument}
            </pre>
          </div>
        </div>
        {(report.results?.length ?? 0) > 0 && (
          <div className="report-section">
            <h3>Subtask Deliverables</h3>
            {report.results!.map((r, i) => (
              <div key={i} className="card agent-position" style={{ marginBottom: 12 }}>
                <div className="agent-position-header">
                  <span className="agent-role-badge">{r.agentRole.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtaskId}</span>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.7 }}>{r.deliverable}</p>
                {r.concerns.map((c, j) => <div key={j} className="risk-item" style={{ marginTop: 6 }}>{c}</div>)}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
          Cost: ${report.totalCostUsd.toFixed(4)}
        </div>
      </div>
    );
  }

  // Debate mode (default)
  const consensus = report.consensus!;
  return (
    <div>
      {/* Consensus summary */}
      <div className="report-section">
        <h3>Consensus</h3>
        <div className="card" style={{ gap: 12, display: 'flex', flexDirection: 'column' }}>
          <div className="row">
            <span className={`tag ${consensus.reached ? 'tag-complete' : 'tag-running'}`}>
              {consensus.reached ? '✓ Reached' : '⚡ Partial'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{report.rounds} round{report.rounds !== 1 ? 's' : ''}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Cost: ${report.totalCostUsd.toFixed(4)}
            </span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>{consensus.recommendation}</p>
          {consensus.blockingObjections.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--red)', marginBottom: 8 }}>Blocking Objections</div>
              {consensus.blockingObjections.map((o, i) => (
                <div key={i} className="risk-item" style={{ background: 'rgba(239,68,68,0.1)' }}>{o}</div>
              ))}
            </div>
          )}
          {consensus.dissent.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--yellow)', marginBottom: 8 }}>Dissent</div>
              {consensus.dissent.map((d, i) => <div key={i} style={{ fontSize: 13, color: 'var(--text-muted)', paddingLeft: 8, borderLeft: '2px solid var(--yellow)', marginBottom: 6 }}>{d}</div>)}
            </div>
          )}
        </div>
      </div>

      {/* Agent positions */}
      <div className="report-section">
        <h3>Agent Positions</h3>
        {report.positions!.map((pos, i) => (
          <div key={i} className="card agent-position">
            <div className="agent-position-header">
              <span className="agent-role-badge">{pos.agentRole.replace(/_/g, ' ')}</span>
              <span className="provider-badge">{pos.provider}</span>
              {pos.finalVote && (
                <span className={`tag ${pos.finalVote.vote === 'accept' ? 'tag-complete' : pos.finalVote.vote === 'reject' ? 'tag-error' : 'tag-pending'}`} style={{ marginLeft: 'auto' }}>
                  {pos.finalVote.vote}
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: pos.finalVote ? 0 : 'auto' }}>
                {Math.round(pos.proposal.confidence * 100)}% confidence
              </span>
            </div>

            <p style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.7 }}>{pos.proposal.recommendation}</p>

            {pos.proposal.reasoning.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Reasoning</div>
                <ul className="reasoning-list">
                  {pos.proposal.reasoning.map((r, j) => <li key={j}><span>{r}</span></li>)}
                </ul>
              </div>
            )}

            {pos.proposal.assumptions.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Assumptions</div>
                <ul className="reasoning-list">
                  {pos.proposal.assumptions.map((a, j) => <li key={j}><span>{a}</span></li>)}
                </ul>
              </div>
            )}

            {pos.proposal.risks.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Risks</div>
                {pos.proposal.risks.map((r, j) => <div key={j} className="risk-item">{r}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Risk summary */}
      {report.riskSummary!.length > 0 && (
        <div className="report-section">
          <h3>Risk Summary</h3>
          <div className="card">
            {report.riskSummary!.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                <SeverityDot s={r.severity} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{r.severity}</span>
                  {' — '}
                  <span style={{ fontSize: 13 }}>{r.description}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>({r.raisedBy})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
