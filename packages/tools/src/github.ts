import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission, GateType } from './interface.js';
import { redact } from '@consensus/secrets';

export type GitHubOperation =
  | 'get_repo'
  | 'list_files'
  | 'read_file'
  | 'create_branch'
  | 'commit_file'
  | 'batch_commit'
  | 'open_pr';

export interface GitHubInput {
  operation: GitHubOperation;
  owner: string;
  repo: string;
  path?: string;
  branch?: string;
  baseBranch?: string;
  content?: string;
  message?: string;
  title?: string;
  body?: string;
  base?: string;
  head?: string;
  /** batch_commit: list of files to commit atomically */
  files?: Array<{ path: string; content: string }>;
}

const PROTECTED_BRANCHES = new Set(['main', 'master', 'production', 'prod', 'release']);
const VALID_OPS: GitHubOperation[] = ['get_repo','list_files','read_file','create_branch','commit_file','batch_commit','open_pr'];

/** Sanitize a branch name to a safe slug. Removes leading/trailing slashes and
 *  collapses any sequence of chars that aren't alphanumeric, hyphen, or underscore
 *  into a single hyphen. Truncates to 100 chars. */
function slugifyBranch(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9/_.-]/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[/.-]+|[/.-]+$/g, '')
    .slice(0, 100);
}

export class GitHubTool implements ITool {
  readonly name = 'github';
  readonly description = 'Read GitHub repos and propose changes via feature branches and PRs. Never commits to main/master.';
  readonly permissions: ToolPermission[] = ['read', 'write'];
  readonly gates: Record<string, GateType> = {
    get_repo:      'auto_allow',
    list_files:    'auto_allow',
    read_file:     'auto_allow',
    create_branch: 'approval_required',
    commit_file:   'approval_required',
    batch_commit:  'approval_required',  // one approval for all files in the batch
    open_pr:       'approval_required',
  };

  constructor(private readonly getToken: () => string | undefined = () => process.env.GITHUB_TOKEN) {}

  private get token(): string {
    const t = this.getToken();
    if (!t) throw new Error('GITHUB_TOKEN not configured');
    return t;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`GitHub API ${method} ${path} → ${resp.status}: ${redact(text).slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, error: 'Input must be an object' };
    const i = input as Record<string, unknown>;
    if (!VALID_OPS.includes(i.operation as GitHubOperation))
      return { valid: false, error: `operation must be one of: ${VALID_OPS.join(', ')}` };
    if (typeof i.owner !== 'string' || !i.owner) return { valid: false, error: 'owner is required' };
    if (typeof i.repo !== 'string' || !i.repo) return { valid: false, error: 'repo is required' };
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    let inp = input as GitHubInput;
    const start = Date.now();

    if (inp.operation === 'open_pr' && inp.head && PROTECTED_BRANCHES.has(inp.head.toLowerCase())) {
      return { success: false, output: null, error: `Cannot open PR from protected branch '${inp.head}' as head.`, metadata: { durationMs: 0 } };
    }

    try {
      const { owner, repo } = inp;
      let output: unknown;

      switch (inp.operation) {
        case 'get_repo': {
          const d = await this.api<Record<string, unknown>>('GET', `/repos/${owner}/${repo}`);
          output = { fullName: d.full_name, description: d.description, defaultBranch: d.default_branch, private: d.private, language: d.language };
          break;
        }
        case 'list_files': {
          const branch = inp.branch ?? 'main';
          const path = inp.path ?? '';
          const data = await this.api<Array<Record<string, unknown>>>('GET',
            `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
          output = data.map(f => ({ name: f.name, path: f.path, type: f.type, size: f.size, sha: f.sha }));
          break;
        }
        case 'read_file': {
          if (!inp.path) return { success: false, output: null, error: 'path is required', metadata: { durationMs: 0 } };
          const branch = inp.branch ?? 'main';
          const data = await this.api<Record<string, unknown>>('GET',
            `/repos/${owner}/${repo}/contents/${inp.path}?ref=${encodeURIComponent(branch)}`);
          output = { path: inp.path, content: Buffer.from(data.content as string, 'base64').toString('utf-8'), sha: data.sha };
          break;
        }
        case 'create_branch': {
          if (!inp.branch) return { success: false, output: null, error: 'branch is required', metadata: { durationMs: 0 } };
          const sanitizedBranch = slugifyBranch(inp.branch);
          if (!sanitizedBranch) return { success: false, output: null, error: 'branch name is invalid after sanitization', metadata: { durationMs: 0 } };
          if (PROTECTED_BRANCHES.has(sanitizedBranch.toLowerCase()))
            return { success: false, output: null, error: `Cannot create protected branch '${sanitizedBranch}'`, metadata: { durationMs: 0 } };
          inp = { ...inp, branch: sanitizedBranch };
          const baseBranch = inp.baseBranch ?? 'main';
          const ref = await this.api<{ object: { sha: string } }>('GET',
            `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
          await this.api<unknown>('POST', `/repos/${owner}/${repo}/git/refs`,
            { ref: `refs/heads/${inp.branch}`, sha: ref.object.sha });
          output = { branch: inp.branch, baseSha: ref.object.sha, baseBranch };
          break;
        }
        case 'commit_file': {
          if (!inp.path || !inp.branch || inp.content === undefined || !inp.message)
            return { success: false, output: null, error: 'path, branch, content, and message are required', metadata: { durationMs: 0 } };
          if (PROTECTED_BRANCHES.has(inp.branch.toLowerCase()))
            return { success: false, output: null, error: `Commit to protected branch '${inp.branch}' is always denied.`, metadata: { durationMs: 0 } };
          if (redact(inp.content) !== inp.content)
            return { success: false, output: null, error: 'Commit blocked: content contains detected secret patterns.', metadata: { durationMs: 0 } };
          if (redact(inp.message) !== inp.message)
            return { success: false, output: null, error: 'Commit blocked: commit message contains detected secret patterns.', metadata: { durationMs: 0 } };
          let existingSha: string | undefined;
          try {
            const ex = await this.api<{ sha: string }>('GET', `/repos/${owner}/${repo}/contents/${inp.path}?ref=${encodeURIComponent(inp.branch)}`);
            existingSha = ex.sha;
          } catch { /* new file */ }
          const result = await this.api<{ commit: { sha: string } }>('PUT',
            `/repos/${owner}/${repo}/contents/${inp.path}`, {
              message: inp.message,
              content: Buffer.from(inp.content, 'utf-8').toString('base64'),
              branch: inp.branch,
              ...(existingSha ? { sha: existingSha } : {}),
            });
          output = { committed: true, path: inp.path, branch: inp.branch, commitSha: result.commit.sha };
          break;
        }
        case 'batch_commit': {
          if (!inp.branch || !inp.message || !inp.files?.length)
            return { success: false, output: null, error: 'branch, message, and files[] are required', metadata: { durationMs: 0 } };
          if (PROTECTED_BRANCHES.has(inp.branch.toLowerCase()))
            return { success: false, output: null, error: `Commit to protected branch '${inp.branch}' is always denied.`, metadata: { durationMs: 0 } };
          if (redact(inp.message) !== inp.message)
            return { success: false, output: null, error: 'Commit blocked: message contains detected secret patterns.', metadata: { durationMs: 0 } };
          for (const f of inp.files) {
            if (redact(f.content) !== f.content)
              return { success: false, output: null, error: `Commit blocked: ${f.path} contains detected secret patterns.`, metadata: { durationMs: 0 } };
          }
          // Git Trees API: atomic multi-file commit
          const headRef = await this.api<{ object: { sha: string } }>('GET',
            `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(inp.branch)}`);
          const headSha = headRef.object.sha;
          const headCommit = await this.api<{ tree: { sha: string } }>('GET',
            `/repos/${owner}/${repo}/git/commits/${headSha}`);
          const basTreeSha = headCommit.tree.sha;
          const treeItems = await Promise.all(inp.files.map(async f => {
            const blob = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/blobs`, {
              content: Buffer.from(f.content, 'utf-8').toString('base64'),
              encoding: 'base64',
            });
            return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
          }));
          const newTree = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/trees`, {
            base_tree: basTreeSha,
            tree: treeItems,
          });
          const newCommit = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/commits`, {
            message: inp.message,
            tree: newTree.sha,
            parents: [headSha],
          });
          await this.api<unknown>('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(inp.branch)}`, {
            sha: newCommit.sha,
          });
          output = { committed: true, branch: inp.branch, commitSha: newCommit.sha, filesCount: inp.files.length };
          break;
        }
        case 'open_pr': {
          if (!inp.title || !inp.head)
            return { success: false, output: null, error: 'title and head branch are required', metadata: { durationMs: 0 } };
          if (inp.body && redact(inp.body) !== inp.body)
            return { success: false, output: null, error: 'PR blocked: body contains detected secret patterns.', metadata: { durationMs: 0 } };
          const pr = await this.api<{ number: number; html_url: string; title: string; state: string }>('POST',
            `/repos/${owner}/${repo}/pulls`,
            { title: inp.title, body: inp.body ?? '', head: inp.head, base: inp.base ?? 'main' });
          output = { number: pr.number, url: pr.html_url, title: pr.title, state: pr.state };
          break;
        }
      }

      await context.auditLog(`github.${inp.operation}`, { owner, repo, path: inp.path, branch: inp.branch, projectId: context.projectId });
      return { success: true, output, metadata: { durationMs: Date.now() - start } };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message, metadata: { durationMs: Date.now() - start } };
    }
  }
}
