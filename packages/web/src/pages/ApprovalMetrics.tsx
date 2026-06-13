import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchApprovalMetrics, type ApprovalMetrics, type ApprovalMetricRow } from '../api';

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', minWidth: 80, flex: 1 }}>
      <div style={{ height: '100%', width: pct(value), background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  );
}

function ReputationBadge({ rate, decisions }: { rate: number; decisions: number }) {
  if (decisions < 5) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>insufficient data</span>;
  if (rate >= 0.9) return <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>HIGH TRUST</span>;
  if (rate >= 0.7) return <span style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 700 }}>MODERATE</span>;
  return <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>LOW TRUST</span>;
}

function MetricRow({ row }: { row: ApprovalMetricRow }) {
  const humanDecisions = row.approved + row.denied;
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)', flex: 1 }}>
          {row.agentRole ?? 'system'}
        </span>
        <ReputationBadge rate={row.approvalRate} decisions={humanDecisions} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct(row.approvalRate)} approved</span>
      </div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--green)' }}>✓ {row.approved} approved</span>
        <span style={{ color: 'var(--red)' }}>✗ {row.denied} denied</span>
        <span style={{ color: 'var(--text-muted)' }}>⚡ {row.autoAllowed} auto</span>
        <span style={{ marginLeft: 'auto' }}>{row.total} total</span>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Bar value={row.approved / Math.max(row.total, 1)} color="var(--green)" />
        <Bar value={row.denied / Math.max(row.total, 1)} color="var(--red)" />
        <Bar value={row.autoAllowed / Math.max(row.total, 1)} color="var(--accent)" />
      </div>
    </div>
  );
}

export default function ApprovalMetricsPage() {
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;

  const [metrics, setMetrics] = useState<ApprovalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApprovalMetrics(projectId)
      .then(m => { setMetrics(m); setError(null); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div>
      <div className="page-header">
        <h2 style={{ fontSize: 18 }}>Approval Metrics</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Agent trust scores derived from historical approval decisions
          {projectId && ` · project ${projectId}`}
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 16 }}>
          <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : !metrics || metrics.rows.length === 0 ? (
        <div className="empty-state">
          <p>No approval data yet.</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            Run a PR workflow to generate approval telemetry.
          </p>
        </div>
      ) : (
        <>
          {/* Global summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
            {[
              { label: 'Global approval rate', value: pct(metrics.globalApprovalRate), color: metrics.globalApprovalRate >= 0.8 ? 'var(--green)' : 'var(--yellow)' },
              { label: 'Total human decisions', value: String(metrics.totalDecisions), color: 'var(--text)' },
              { label: 'High-trust agents', value: String(metrics.highTrustAgents.length), color: 'var(--green)' },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {metrics.highTrustAgents.length > 0 && (
            <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--green)' }}>High-trust agents (≥90% approval, ≥10 decisions)</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                These agents could be candidates for expanded auto-allow rules:
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {metrics.highTrustAgents.map(a => (
                  <span key={a} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4 }}>{a}</span>
                ))}
              </div>
            </div>
          )}

          <div className="section-title" style={{ marginBottom: 12 }}>Per-agent breakdown</div>
          {metrics.rows.map((row, i) => <MetricRow key={i} row={row} />)}
        </>
      )}
    </div>
  );
}
