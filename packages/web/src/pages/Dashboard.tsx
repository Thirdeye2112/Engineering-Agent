import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchProjects, type Project } from '../api';
import ProjectForm from '../components/ProjectForm';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetchProjects()
      .then(p => setProjects([...p].reverse()))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2>Dashboard</h2>
          <p>Run a multi-agent debate or collaboration project</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(f => !f)}>
          {showForm ? 'Cancel' : '+ New project'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 28 }}>
          <div className="section-title" style={{ marginBottom: 20 }}>New project</div>
          <ProjectForm onCreated={() => { setShowForm(false); reload(); }} />
        </div>
      )}

      <div className="section-title">Recent projects</div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <span className="spinner" />
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>⬡</div>
          <p>No projects yet. Create one above to get started.</p>
        </div>
      ) : (
        <div className="project-list">
          {projects.map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} style={{ textDecoration: 'none' }}>
              <div className="card project-card">
                <div className="project-card-body">
                  <h3>{p.task}</h3>
                  <p>{p.mode} · {timeAgo(p.createdAt)}</p>
                </div>
                <div className="project-card-meta">
                  <span className={`tag tag-${p.status}`}>{p.status}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
