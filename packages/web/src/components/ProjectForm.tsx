import { useState } from 'react';
import { createProject, type CreateProjectPayload } from '../api';
import { hasKey } from '../store';
import { useNavigate } from 'react-router-dom';

const ROLES = ['architect', 'devil_advocate', 'security_reviewer', 'performance_analyst', 'ux_reviewer', 'domain_expert'];
const PROVIDERS = ['anthropic', 'openai', 'google'];
const TIERS = ['fast', 'standard', 'premium'];

interface AgentRow { provider: string; tier: string; role: string; }

export default function ProjectForm({ onCreated }: { onCreated?: () => void } = {}) {
  const navigate = useNavigate();
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'debate' | 'collaborate'>('debate');
  const [maxRounds, setMaxRounds] = useState(3);
  const [budgetCap, setBudgetCap] = useState('1.00');
  const [agents, setAgents] = useState<AgentRow[]>([
    { provider: 'anthropic', tier: 'fast', role: 'architect' },
    { provider: 'anthropic', tier: 'fast', role: 'devil_advocate' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function addAgent() {
    setAgents(a => [...a, { provider: 'anthropic', tier: 'fast', role: 'architect' }]);
  }
  function removeAgent(i: number) {
    setAgents(a => a.filter((_, idx) => idx !== i));
  }
  function updateAgent(i: number, key: keyof AgentRow, val: string) {
    setAgents(a => a.map((ag, idx) => idx === i ? { ...ag, [key]: val } : ag));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!task.trim()) { setError('Task is required'); return; }
    if (agents.length < 1) { setError('At least one agent required'); return; }

    setLoading(true);
    try {
      const payload: CreateProjectPayload = {
        task: task.trim(),
        mode,
        agents,
        maxRounds,
        budgetCap: budgetCap ? parseFloat(budgetCap) : undefined,
      };
      const { projectId } = await createProject(payload);
      onCreated?.();
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const availableProviders = PROVIDERS.filter(p => {
    if (p === 'anthropic') return hasKey('anthropicKey');
    if (p === 'openai') return hasKey('openaiKey');
    if (p === 'google') return hasKey('googleKey');
    return false;
  });

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div className="field">
        <label>Task</label>
        <textarea
          rows={3}
          placeholder="Describe what you want the agents to work on..."
          value={task}
          onChange={e => setTask(e.target.value)}
        />
      </div>

      <div className="grid-2">
        <div className="field">
          <label>Mode</label>
          <select value={mode} onChange={e => setMode(e.target.value as 'debate' | 'collaborate')}>
            <option value="debate">Debate — all agents analyse, critique, vote</option>
            <option value="collaborate">Collaborate — subtasks assigned by role</option>
          </select>
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Max rounds</label>
            <input type="number" min={1} max={10} value={maxRounds} onChange={e => setMaxRounds(parseInt(e.target.value))} />
          </div>
          <div className="field">
            <label>Budget cap ($)</label>
            <input type="number" min={0} step={0.01} value={budgetCap} onChange={e => setBudgetCap(e.target.value)} />
          </div>
        </div>
      </div>

      <div>
        <div className="section-title">Agents</div>
        <div className="stack">
          {agents.map((ag, i) => (
            <div key={i} className="agent-entry">
              <span style={{ color: 'var(--text-muted)', fontSize: 12, width: 20, flexShrink: 0 }}>{i + 1}</span>
              <div className="agent-entry-body">
                <div className="field" style={{ gap: 4 }}>
                  <label>Provider</label>
                  <select value={ag.provider} onChange={e => updateAgent(i, 'provider', e.target.value)}>
                    {PROVIDERS.map(p => (
                      <option key={p} value={p} disabled={availableProviders.length > 0 && !availableProviders.includes(p)}>
                        {p}{availableProviders.length > 0 && !availableProviders.includes(p) ? ' (no key)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ gap: 4 }}>
                  <label>Tier</label>
                  <select value={ag.tier} onChange={e => updateAgent(i, 'tier', e.target.value)}>
                    {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field" style={{ gap: 4 }}>
                  <label>Role</label>
                  <select value={ag.role} onChange={e => updateAgent(i, 'role', e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <button type="button" className="btn-ghost" onClick={() => removeAgent(i)} style={{ padding: '4px 8px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={addAgent} style={{ width: 'fit-content' }}>+ Add agent</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <><span className="spinner" /> Starting…</> : 'Run project'}
        </button>
      </div>
    </form>
  );
}
