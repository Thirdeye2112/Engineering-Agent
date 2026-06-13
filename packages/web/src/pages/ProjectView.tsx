import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchProject, openProjectSocket, type Project } from '../api';
import EventStream from '../components/EventStream';
import ReportView from '../components/ReportView';

interface PendingApproval {
  requestId: string;
  detail: { agentRole: string; tool: string; operation: string; rationale: string };
}

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; [key: string]: unknown }>>([]);
  const [loading, setLoading] = useState(true);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!id) return;

    fetchProject(id).then(p => {
      setProject(p);
      setLoading(false);

      if (p.status === 'running') {
        const ws = openProjectSocket(id, (e) => {
          const ev = e as { type: string; [key: string]: unknown };
          setEvents(prev => [...prev, ev]);
          if (ev.type === 'deliberation_complete') {
            fetchProject(id).then(setProject).catch(() => {});
          }
          if (ev.type === 'permission_requested') {
            setPendingApprovals(prev => [...prev, {
              requestId: ev.requestId as string,
              detail: ev.detail as PendingApproval['detail'],
            }]);
          }
          if (ev.type === 'permission_approved' || ev.type === 'permission_denied') {
            setPendingApprovals(prev => prev.filter(a => a.requestId !== ev.requestId));
          }
        });
        wsRef.current = ws;
      }
    }).catch(() => setLoading(false));

    return () => { wsRef.current?.close(); };
  }, [id]);

  // Poll every 3s while running
  useEffect(() => {
    if (!id || !project || project.status !== 'running') return;
    const interval = setInterval(() => {
      fetchProject(id).then(p => {
        setProject(p);
        if (p.status !== 'running') clearInterval(interval);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [id, project?.status]);

  async function handleApproval(requestId: string, decision: 'approve' | 'deny') {
    await fetch(`/api/permission-requests/${requestId}/${decision}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewedBy: 'human' }),
    });
    setPendingApprovals(prev => prev.filter(a => a.requestId !== requestId));
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>;
  }
  if (!project) {
    return <div className="empty-state"><p>Project not found.</p></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ marginBottom: 10 }}>
          <Link to="/dashboard" style={{ fontSize: 12, color: 'var(--text-muted)' }}>← Dashboard</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, flex: 1, minWidth: 0 }}>{project.task}</h2>
          <span className={`tag tag-${project.status}`}>{project.status}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{project.mode} mode</span>
        </div>
      </div>

      {/* Human approval dialogs */}
      {pendingApprovals.map(req => (
        <div key={req.requestId} className="card" style={{
          borderColor: 'var(--yellow)', marginBottom: 16,
          background: 'rgba(234,179,8,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>🔐</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Permission request</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                <strong style={{ color: 'var(--text)' }}>{req.detail?.agentRole}</strong>
                {' wants to use '}
                <strong style={{ color: 'var(--accent)' }}>{req.detail?.tool}.{req.detail?.operation}</strong>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 12 }}>
                "{req.detail?.rationale}"
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn-primary" onClick={() => handleApproval(req.requestId, 'approve')}>
                  Approve
                </button>
                <button className="btn-danger" onClick={() => handleApproval(req.requestId, 'deny')}>
                  Deny
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {(project.status === 'running' || events.length > 0) && (
        <div style={{ marginBottom: 28 }}>
          <div className="section-title">Live events</div>
          <EventStream events={events as Array<{ type: string }>} />
        </div>
      )}

      {project.report && <ReportView report={project.report} />}

      {project.status === 'error' && !project.report && (
        <div className="card" style={{ borderColor: 'var(--red)', textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 8 }}>Project failed</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Check server logs for details.</p>
        </div>
      )}
    </div>
  );
}
