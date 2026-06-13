export interface Credentials {
  anthropicKey: string;
  openaiKey: string;
  googleKey: string;
  githubToken: string;
  sandboxRoot: string;
}

const KEY = 'consensus_credentials';

export function getCredentials(): Credentials {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {} as Credentials;
  }
}

export function saveCredentials(creds: Partial<Credentials>): void {
  const existing = getCredentials();
  localStorage.setItem(KEY, JSON.stringify({ ...existing, ...creds }));
}

export function hasKey(platform: keyof Credentials): boolean {
  const c = getCredentials();
  return !!(c[platform] && c[platform].length > 4);
}

export function clearCredentials(): void {
  localStorage.removeItem(KEY);
}
