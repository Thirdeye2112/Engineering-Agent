import { useState } from 'react';
import { getCredentials, saveCredentials } from '../store';

const PLATFORMS = [
  {
    key: 'anthropicKey' as const,
    label: 'Anthropic',
    placeholder: 'sk-ant-...',
    description: 'Claude models (Haiku, Sonnet, Opus)',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    key: 'openaiKey' as const,
    label: 'OpenAI',
    placeholder: 'sk-...',
    description: 'GPT-4o, GPT-4o-mini, o1',
    url: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'googleKey' as const,
    label: 'Google AI',
    placeholder: 'AIza...',
    description: 'Gemini 1.5 Flash, Pro, 2.0',
    url: 'https://aistudio.google.com/app/apikey',
  },
];

export default function Credentials() {
  const [form, setForm] = useState(getCredentials());
  const [saved, setSaved] = useState(false);

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  function handleSave() {
    saveCredentials(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ANTHROPIC_API_KEY: form.anthropicKey,
        OPENAI_API_KEY: form.openaiKey,
        GOOGLE_API_KEY: form.googleKey,
        GITHUB_TOKEN: form.githubToken,
        FILESYSTEM_SANDBOX_ROOT: form.sandboxRoot,
      }),
    }).catch(() => { /* endpoint may not exist yet */ });
  }

  return (
    <div>
      <div className="page-header">
        <h2>Credentials</h2>
        <p>API keys are stored in your browser's localStorage. They are never sent to any server except the local Consensus AI backend.</p>
      </div>

      <div className="stack">
        {/* AI Platforms */}
        <div className="card">
          <div className="section-title">AI Platforms</div>
          <div className="stack">
            {PLATFORMS.map(p => (
              <div key={p.key} className="field">
                <div className="credentials-platform">
                  <label style={{ marginBottom: 0 }}>{p.label}</label>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{p.description}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, flexShrink: 0 }}>Get key ↗</a>
                </div>
                <input
                  type="password"
                  placeholder={p.placeholder}
                  value={form[p.key] ?? ''}
                  onChange={e => set(p.key, e.target.value)}
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </div>

        {/* GitHub */}
        <div className="card">
          <div className="section-title">GitHub</div>
          <div className="field">
            <div className="credentials-platform">
              <label style={{ marginBottom: 0 }}>Personal Access Token</label>
              <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer" style={{ fontSize: 11, marginLeft: 'auto' }}>Create token ↗</a>
            </div>
            <input
              type="password"
              placeholder="ghp_..."
              value={form.githubToken ?? ''}
              onChange={e => set('githubToken', e.target.value)}
              autoComplete="off"
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Required scopes: <code>repo</code>, <code>read:org</code>
            </p>
          </div>
        </div>

        {/* Local Files */}
        <div className="card">
          <div className="section-title">Local File Access</div>
          <div className="field">
            <label>Sandbox Root Path</label>
            <input
              type="text"
              placeholder="./sandbox  or  /absolute/path/to/project"
              value={form.sandboxRoot ?? ''}
              onChange={e => set('sandboxRoot', e.target.value)}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Agents can only read and write files within this directory. Path traversal outside the sandbox is blocked.
            </p>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={handleSave}>Save credentials</button>
        </div>
      </div>

      {saved && <div className="saved-toast">✓ Saved</div>}
    </div>
  );
}
