import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchProject, openProjectSocket, type Project } from '../api';
import EventStream from '../components/EventStream';
import ReportView from '../components/ReportView';

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [events, setEvents] = useState<Array<{ type: string; [key: string]: unknown }>>([]);
  const [loading, setLoading] = useState(true);
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
        });
        wsRef.current = ws;
      }
    }).catch(() => setLoading(false));

    return () => { wsRef.current?.close(); };
  }, [id]);

  // Poll every 3s while running (handles cases where WS missed events)
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
