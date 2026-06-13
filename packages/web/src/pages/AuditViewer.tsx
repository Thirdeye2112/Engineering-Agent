import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { verifyAuditChain, fetchAuditEvents, type AuditEvent, type AuditVerifyResult } from '../api';

const STATUS_COLORS: Record<string, string> = {
  approved: 'var(--green)',
  denied: 'var(--red)',
  pending: 'var(--yellow)',
  not_required: 'var(--text-muted)',
};

export default function AuditViewer() {
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? undefined;

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verify, setVerify] = useState<AuditVerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    Promise.all([
      fetchAuditEvents(projectId, 200),
      verifyAuditChain(projectId),
    ]).then(([evs, v]) => {
      setEvents(evs);
      setVerify(v);
      setError(null);
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  const filtered = filter
    ? events.filter(e =>
        e.actionType.includes(filter) ||
        (e.actorId ?? '').includes(filter) ||
        (e.toolName ?? '').includes(filter)
      )
    : events;

  if (!projectId) {
    return (
      <div>
        <div className="page-header">
          <h2 style={{ fontSize: 18 }}>Audit Viewer</h2>
        </div>
        <div className="empty-state">
          <p>Open from a project page to view its audit trail.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2 style={{ fontSize: 18 }}>Audit Trail</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Project {projectId}</p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 16 }}>
          <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>
        </div>
      )}

      {verify && (
        <div className="card" style={{ borderColor: verify.valid ? 'var(--green)' : 'var(--red)', marginBottom: 20, display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 20 }}>{verify.valid ? '🔒' : '⚠️'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: verify.valid ? 'var(--green)' : 'var(--red)', marginBottom: 2 }}>
              Hash chain {verify.valid ? 'valid' : 'INVALID'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {verify.checkedCount} events verified
              {!verify.valid && verify.firstInvalidId && ` · first invalid: ${verify.firstInvalidId}`}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <input
              placeholder="Filter by action, actor, or tool..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }}
            />
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state"><p>No events found.</p></div>
          ) : (
            <div>
              {filtered.map((ev, i) => (
                <div key={ev.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 24, paddingTop: 1 }}>
                    {filtered.length - i}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{ev.actionType}</span>
                      {ev.toolName && (
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{ev.toolName}</span>
                      )}
                      {ev.approvalStatus && ev.approvalStatus !== 'not_required' && (
                        <span style={{ fontSize: 11, color: STATUS_COLORS[ev.approvalStatus] ?? 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                          {ev.approvalStatus}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      <span style={{ textTransform: 'uppercase', fontSize: 10 }}>{ev.actorType}</span>
                      {ev.actorId && <span> · {ev.actorId}</span>}
                      {ev.inputSummary && <span> · {ev.inputSummary.slice(0, 120)}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0 }} title={ev.eventHash}>
                    {ev.eventHash.slice(0, 8)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
