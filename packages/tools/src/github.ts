import { Octokit } from '@octokit/rest';
import type { ITool, ToolContext, ToolResult, ValidationResult, ToolPermission } from './interface.js';

type Operation = 'get_file' | 'create_branch' | 'commit_files' | 'open_pr' | 'get_pr' | 'list_issues';

export interface GitHubInput {
  operation: Operation;
  // get_file
  path?: string;
  ref?: string;
  // create_branch
  branch?: string;
  fromBranch?: string;
  // commit_files
  files?: Array<{ path: string; content: string }>;
  message?: string;
  // open_pr
  title?: string;
  body?: string;
  head?: string;
  base?: string;
  draft?: boolean;
  // get_pr
  prNumber?: number;
}

export class GitHubTool implements ITool {
  readonly name = 'github';
  readonly description = 'Interact with GitHub: get_file, create_branch, commit_files, open_pr, get_pr, list_issues.';
  readonly permissions: ToolPermission[] = ['read', 'write'];

  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN env var required');
    this.owner = process.env.GITHUB_OWNER ?? '';
    this.repo = process.env.GITHUB_REPO ?? '';
    if (!this.owner || !this.repo) throw new Error('GITHUB_OWNER and GITHUB_REPO env vars required');
    this.octokit = new Octokit({ auth: token });
  }

  validate(input: unknown): ValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, error: 'Input must be an object' };
    const i = input as Record<string, unknown>;
    const ops: Operation[] = ['get_file', 'create_branch', 'commit_files', 'open_pr', 'get_pr', 'list_issues'];
    if (!ops.includes(i.operation as Operation)) return { valid: false, error: `operation must be one of: ${ops.join(', ')}` };
    return { valid: true };
  }

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const v = this.validate(input);
    if (!v.valid) return { success: false, output: null, error: v.error, metadata: { durationMs: 0 } };

    const i = input as GitHubInput;
    const start = Date.now();

    const writeOps: Operation[] = ['create_branch', 'commit_files', 'open_pr'];
    if (writeOps.includes(i.operation) && context.permissionLevel === 'read') {
      return { success: false, output: null, error: 'write permission required', metadata: { durationMs: 0 } };
    }

    try {
      let output: unknown;

      switch (i.operation) {
        case 'get_file': {
          const resp = await this.octokit.repos.getContent({
            owner: this.owner, repo: this.repo,
            path: i.path!, ref: i.ref,
          });
          const data = resp.data as { content?: string; encoding?: string };
          output = data.encoding === 'base64' && data.content
            ? Buffer.from(data.content, 'base64').toString('utf-8')
            : data;
          break;
        }
        case 'create_branch': {
          const base = await this.octokit.repos.getBranch({ owner: this.owner, repo: this.repo, branch: i.fromBranch ?? 'main' });
          await this.octokit.git.createRef({
            owner: this.owner, repo: this.repo,
            ref: `refs/heads/${i.branch}`,
            sha: base.data.commit.sha,
          });
          output = { branch: i.branch };
          break;
        }
        case 'commit_files': {
          const files = i.files ?? [];
          const blobs = await Promise.all(files.map(f =>
            this.octokit.git.createBlob({ owner: this.owner, repo: this.repo, content: f.content, encoding: 'utf-8' })
          ));
          const baseRef = await this.octokit.git.getRef({ owner: this.owner, repo: this.repo, ref: `heads/${i.branch ?? 'main'}` });
          const baseTree = await this.octokit.git.getCommit({ owner: this.owner, repo: this.repo, commit_sha: baseRef.data.object.sha });
          const tree = await this.octokit.git.createTree({
            owner: this.owner, repo: this.repo,
            base_tree: baseTree.data.tree.sha,
            tree: blobs.map((b, idx) => ({ path: files[idx].path, mode: '100644', type: 'blob', sha: b.data.sha })),
          });
          const commit = await this.octokit.git.createCommit({
            owner: this.owner, repo: this.repo,
            message: i.message ?? 'agent commit',
            tree: tree.data.sha,
            parents: [baseRef.data.object.sha],
          });
          await this.octokit.git.updateRef({ owner: this.owner, repo: this.repo, ref: `heads/${i.branch ?? 'main'}`, sha: commit.data.sha });
          output = { sha: commit.data.sha };
          break;
        }
        case 'open_pr': {
          const pr = await this.octokit.pulls.create({
            owner: this.owner, repo: this.repo,
            title: i.title!, body: i.body,
            head: i.head!, base: i.base ?? 'main',
            draft: i.draft ?? false,
          });
          output = { prNumber: pr.data.number, url: pr.data.html_url };
          break;
        }
        case 'get_pr': {
          const pr = await this.octokit.pulls.get({ owner: this.owner, repo: this.repo, pull_number: i.prNumber! });
          output = { number: pr.data.number, title: pr.data.title, state: pr.data.state, url: pr.data.html_url };
          break;
        }
        case 'list_issues': {
          const issues = await this.octokit.issues.listForRepo({ owner: this.owner, repo: this.repo, state: 'open' });
          output = issues.data.map(iss => ({ number: iss.number, title: iss.title, url: iss.html_url }));
          break;
        }
      }

      await context.auditLog(`github.${i.operation}`, { projectId: context.projectId, operation: i.operation });
      return { success: true, output, metadata: { durationMs: Date.now() - start } };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message, metadata: { durationMs: Date.now() - start } };
    }
  }
}
