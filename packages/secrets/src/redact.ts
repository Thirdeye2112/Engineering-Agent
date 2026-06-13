// Patterns ordered most-specific first to avoid partial matches
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'anthropic-key',  pattern: /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{93}/g },
  { name: 'openai-key',     pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g },
  { name: 'google-key',     pattern: /AIza[A-Za-z0-9_-]{35}/g },
  { name: 'github-pat-new', pattern: /github_pat_[A-Za-z0-9_]{82}/g },
  { name: 'github-pat',     pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: 'github-oauth',   pattern: /gho_[A-Za-z0-9]{36}/g },
];

/**
 * Replace any detected secret values in text with [REDACTED:<name>].
 * Apply this to all strings before writing to audit log, console, or tool output summaries.
 */
export function redact(text: string): string {
  let result = text;
  for (const { name, pattern } of SECRET_PATTERNS) {
    result = result.replace(pattern, `[REDACTED:${name}]`);
  }
  return result;
}

export function redactObject(obj: unknown): unknown {
  if (typeof obj === 'string') return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, redactObject(v)])
    );
  }
  return obj;
}

/** Summarise a value for audit log — truncate, redact secrets, stringify if needed. */
export function summarise(value: unknown, maxLength = 500): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  const redacted = redact(raw);
  return redacted.length > maxLength ? redacted.slice(0, maxLength) + '…' : redacted;
}
