import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchPendingApprovals, approveRequest, denyRequest, type PendingApprovalItem } from '../api';

export default function ApprovalQueue() {
  const [items, setItems] = useState<PendingApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<Set<string>>(new Set());

  async function load() {
    try {
      setLoading(true);
      const data = await fetchPendingApprovals();
      setItems(data);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handle(id: string, action: 'approve' | 'deny') {
    setActing(prev => new Set([...prev, id]));
    try {
      if (action === 'approve') await approveRequest(id);
      else await denyRequest(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e) {
      setError(String(e));
    } finally {
      setActing(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 style={{ fontSize: 18 }}>Approval Queue</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Pending agent permission requests requiring human review
        </p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 16 }}>
          <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 15, marginBottom: 6 }}>No pending approvals</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>All agent actions have been reviewed.</p>
        </div>
      ) : (
        <div>
          {items.map(item => (
            <div key={item.id} className="card" style={{ borderColor: 'var(--yellow)', marginBottom: 14, background: 'rgba(234,179,8,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>🔐</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      <span style={{ color: 'var(--text-muted)' }}>{item.agentRole}</span>
                      {' → '}
                      <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{item.tool}.{item.operation}</span>
                    </span>
                    <Link to={`/projects/${item.projectId}`} style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      project ↗
                    </Link>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 10 }}>
                    "{item.rationale}"
                  </p>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Requested {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn-primary"
                      disabled={acting.has(item.id)}
                      onClick={() => handle(item.id, 'approve')}
                    >
                      {acting.has(item.id) ? '...' : 'Approve'}
                    </button>
                    <button
                      className="btn-danger"
                      disabled={acting.has(item.id)}
                      onClick={() => handle(item.id, 'deny')}
                    >
                      {acting.has(item.id) ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
