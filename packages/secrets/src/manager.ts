/**
 * SecretManager abstraction.
 * Default implementation reads from process.env.
 * Future: VaultSecretManager, AWSSecretsManager, etc.
 */
export interface SecretManager {
  get(key: string): string | undefined;
  exists(key: string): boolean;
  /** Update a secret value. In EnvSecretManager this mutates process.env (dev only). */
  set(key: string, value: string): void;
}

const ENV_KEY_MAP: Record<string, string> = {
  anthropicKey:  'ANTHROPIC_API_KEY',
  openaiKey:     'OPENAI_API_KEY',
  googleKey:     'GOOGLE_API_KEY',
  githubToken:   'GITHUB_TOKEN',
  sandboxRoot:   'FILESYSTEM_SANDBOX_ROOT',
  databaseUrl:   'DATABASE_URL',
  redisUrl:      'REDIS_URL',
};

export class EnvSecretManager implements SecretManager {
  get(key: string): string | undefined {
    const envKey = ENV_KEY_MAP[key] ?? key;
    return process.env[envKey];
  }

  exists(key: string): boolean {
    return this.get(key) !== undefined && this.get(key) !== '';
  }

  set(key: string, value: string): void {
    const envKey = ENV_KEY_MAP[key] ?? key;
    process.env[envKey] = value;
  }
}

let _instance: SecretManager = new EnvSecretManager();

export function getSecretManager(): SecretManager {
  return _instance;
}

/** Override for testing or production secret managers. */
export function setSecretManager(manager: SecretManager): void {
  _instance = manager;
}
