interface AgentProposal {
  recommendation: string;
  reasoning: string[];
  assumptions: string[];
  risks: string[];
  confidence: number;
}

interface AgentPosition {
  agentRole: string;
  provider: string;
  proposal: AgentProposal;
  riskFlags: Array<{ severity: string; description: string }>;
  finalVote?: { vote: string; rationale: string };
}

interface Report {
  rounds: number;
  positions: AgentPosition[];
  consensus: {
    reached: boolean;
    recommendation: string;
    dissent: string[];
    blockingObjections: string[];
  };
  riskSummary: Array<{ severity: string; description: string; raisedBy: string }>;
  totalCostUsd: number;
  // collaboration mode
  integratedDocument?: string;
  results?: Array<{ subtaskId: string; agentRole: string; deliverable: string; concerns: string[] }>;
}

function SeverityDot({ s }: { s: string }) {
  const colors: Record<string, string> = {
    low: '#22c55e', medium: '#eab308', high: '#f97316', critical: '#ef4444',
  };
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%',
      background: colors[s] ?? '#888',
      display: 'inline-block', flexShrink: 0, marginTop: 3,
    }} />
  );
}

export default function ReportView({ report }: { report: Report }) {
  // Collaboration mode — show integrated doc + subtask results
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

        {report.results && report.results.length > 0 && (
          <div className="report-section">
            <h3>Subtask Deliverables</h3>
            {report.results.map((r, i) => (
              <div key={i} className="card agent-position" style={{ marginBottom: 12 }}>
                <div className="agent-position-header">
                  <span className="agent-role-badge">{r.agentRole.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtaskId}</span>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: r.concerns.length ? 12 : 0 }}>
                  {r.deliverable}
                </p>
                {r.concerns.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Concerns</div>
                    {r.concerns.map((c, j) => (
                      <div key={j} className="risk-item">{c}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Debate mode
  return (
    <div>
      {/* Consensus summary */}
      <div className="report-section">
        <h3>Consensus</h3>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row">
            <span className={`tag ${report.consensus.reached ? 'tag-complete' : 'tag-running'}`}>
              {report.consensus.reached ? '✓ Reached' : '⚡ Partial'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {report.rounds} round{report.rounds !== 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Cost: ${report.totalCostUsd.toFixed(4)}
            </span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>{report.consensus.recommendation}</p>

          {report.consensus.blockingObjections.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--red)', marginBottom: 8 }}>
                Blocking Objections
              </div>
              {report.consensus.blockingObjections.map((o, i) => (
                <div key={i} className="risk-item" style={{ background: 'rgba(239,68,68,0.1)', marginBottom: 6 }}>{o}</div>
              ))}
            </div>
          )}

          {report.consensus.dissent.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--yellow)', marginBottom: 8 }}>
                Dissent
              </div>
              {report.consensus.dissent.map((d, i) => (
                <div key={i} style={{
                  fontSize: 13, color: 'var(--text-muted)',
                  paddingLeft: 10, borderLeft: '2px solid var(--yellow)', marginBottom: 6,
                }}>{d}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent positions */}
      <div className="report-section">
        <h3>Agent Positions</h3>
        {report.positions.map((pos, i) => (
          <div key={i} className="card agent-position" style={{ marginBottom: 14 }}>
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

            <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 14 }}>{pos.proposal.recommendation}</p>

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
                {pos.proposal.risks.map((r, j) => (
                  <div key={j} className="risk-item" style={{ marginBottom: 6 }}>{r}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Risk summary */}
      {report.riskSummary.length > 0 && (
        <div className="report-section">
          <h3>Risk Summary</h3>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.riskSummary.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <SeverityDot s={r.severity} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {r.severity}
                  </span>
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
