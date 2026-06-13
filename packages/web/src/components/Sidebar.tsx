import { NavLink } from 'react-router-dom';
import { hasKey } from '../store';

const PLATFORMS = [
  { key: 'anthropicKey' as const, label: 'Anthropic' },
  { key: 'openaiKey' as const, label: 'OpenAI' },
  { key: 'googleKey' as const, label: 'Google' },
  { key: 'githubToken' as const, label: 'GitHub' },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>Consensus AI</h1>
        <p>Multi-agent orchestration</p>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span>⬡</span> Dashboard
        </NavLink>
        <NavLink to="/credentials" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span>🔑</span> Credentials
        </NavLink>
      </nav>

      <div className="sidebar-platforms">
        <h3>Platforms</h3>
        {PLATFORMS.map(p => (
          <div key={p.key} className="platform-row">
            <span className={`dot ${hasKey(p.key) ? 'dot-green' : 'dot-muted'}`} />
            <span>{p.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
