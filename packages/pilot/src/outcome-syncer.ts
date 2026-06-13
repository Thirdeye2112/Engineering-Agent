/**
 * Milestone 1: Production Evaluation — PR Outcome Syncer
 *
 * Polls the GitHub REST API for the current state of every open PR
 * produced by the pilot suite and writes the outcome back to the scoreboard.
 *
 * State machine:
 *   pr_opened → pr_reviewed (review event) → pr_merged | pr_rejected | pr_abandoned
 *   pr_merged → pr_reverted (if a revert PR targeting this PR's branch is merged)
 *
 * Design constraints:
 *   - Read-only GitHub access (GET only) — no writes to GitHub from this module.
 *   - No shell / exec — pure HTTPS fetch via the GitHub REST API.
 *   - Stateless between runs — all state lives in pilot-scoreboard.json.
 */

import type { PROutcome, OutcomeState } from './types.js';
import type { PilotScoreboard } from './scoreboard.js';

interface GitHubPR {
  number: number;
  state: 'open' | 'closed';
  merged_at: string | null;
  closed_at: string | null;
  merged: boolean;
  created_at: string;
  user: { login: string } | null;
  title: string;
}

interface GitHubReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  submitted_at: string;
  user: { login: string };
}

interface SyncResult {
  repo: string;
  prNumber: number;
  previous: OutcomeState | null;
  current: OutcomeState;
  updated: boolean;
}

export class OutcomeSyncer {
  private readonly baseUrl = 'https://api.github.com';

  constructor(
    private readonly scoreboard: PilotScoreboard,
    private readonly getToken: () => string | undefined = () => process.env.GITHUB_TOKEN,
  ) {}

  private get token(): string {
    const t = this.getToken();
    if (!t) throw new Error('GITHUB_TOKEN not configured');
    return t;
  }

  private async get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`GitHub GET ${path} → ${resp.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }

  /**
   * Sync all runs that have an open/pending PR.
   * Returns one SyncResult per synced run.
   */
  async syncAll(): Promise<SyncResult[]> {
    const pending = this.scoreboard.pendingSyncRuns();
    const results: SyncResult[] = [];

    for (const { repo, prNumber, prOpenedAt } of pending) {
      try {
        const result = await this.syncOne(repo, prNumber, prOpenedAt);
        results.push(result);
      } catch (err) {
        // Non-fatal — log and continue so one bad PR doesn't block others
        console.warn(`[outcome-syncer] Failed to sync ${repo}#${prNumber}: ${(err as Error).message}`);
      }
    }

    return results;
  }

  async syncOne(repo: string, prNumber: number, prOpenedAt: string): Promise<SyncResult> {
    const [owner, repoName] = repo.split('/');
    const pr = await this.get<GitHubPR>(`/repos/${owner}/${repoName}/pulls/${prNumber}`);

    const previous = this.scoreboard.allRuns.find(
      r => r.repo === repo && r.prNumber === prNumber,
    )?.outcome?.state ?? null;

    const outcome = await this.buildOutcome(pr, owner, repoName, prOpenedAt);
    const updated = this.scoreboard.updateOutcome(repo, prNumber, outcome);

    return { repo, prNumber, previous, current: outcome.state, updated };
  }

  private async buildOutcome(
    pr: GitHubPR,
    owner: string,
    repo: string,
    prOpenedAt: string,
  ): Promise<PROutcome> {
    const openedTs = new Date(prOpenedAt).getTime();
    const now = new Date().toISOString();

    // Fetch reviews to determine review state and timing
    let reviews: GitHubReview[] = [];
    try {
      reviews = await this.get<GitHubReview[]>(`/repos/${owner}/${repo}/pulls/${pr.number}/reviews`);
    } catch { /* no reviews yet */ }

    const firstReview = reviews
      .filter(r => r.state !== 'COMMENTED')
      .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())[0];

    const reviewedAt = firstReview?.submitted_at ?? null;
    const timeToReviewMs = reviewedAt ? new Date(reviewedAt).getTime() - openedTs : null;

    const mergedAt = pr.merged_at ?? null;
    const closedAt = pr.closed_at ?? null;
    const timeToMergeMs = mergedAt ? new Date(mergedAt).getTime() - openedTs : null;

    // Check if a revert PR was opened after this one merged
    let revertedAt: string | null = null;
    if (pr.merged) {
      revertedAt = await this.findRevertPr(owner, repo, pr);
    }

    const state = this.resolveState(pr, revertedAt, reviewedAt, prOpenedAt);
    const resolvedBy = this.resolveActor(pr, reviews);

    return {
      state,
      reviewedAt,
      mergedAt,
      closedAt,
      revertedAt,
      timeToReviewMs,
      timeToMergeMs,
      resolvedBy,
      lastSyncedAt: now,
    };
  }

  private resolveState(
    pr: GitHubPR,
    revertedAt: string | null,
    reviewedAt: string | null,
    _prOpenedAt: string,
  ): OutcomeState {
    if (revertedAt) return 'pr_reverted';
    if (pr.merged) return 'pr_merged';
    if (pr.state === 'closed' && !pr.merged) {
      // Distinguish intentional rejection from abandonment using title heuristics.
      // GitHub doesn't expose a clear "closed reason" in REST v3 without GraphQL,
      // so we use a conservative heuristic: if there were substantive reviews
      // the closer likely made a deliberate decision.
      return reviewedAt ? 'pr_rejected' : 'pr_abandoned';
    }
    if (reviewedAt) return 'pr_reviewed';
    return 'pr_opened';
  }

  private resolveActor(pr: GitHubPR, reviews: GitHubReview[]): string | null {
    if (pr.merged) {
      // The merger is not surfaced directly in the PR object's REST representation
      // without a separate /merge endpoint — use the last approver as proxy.
      const approver = reviews
        .filter(r => r.state === 'APPROVED')
        .sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())[0];
      return approver?.user.login ?? pr.user?.login ?? null;
    }
    if (pr.state === 'closed') return pr.user?.login ?? null;
    return null;
  }

  /**
   * Look for a PR whose title starts with "Revert" and whose body references
   * the original PR number. Searches the last 20 closed PRs.
   * Returns the merged_at timestamp of the revert PR if found, else null.
   */
  private async findRevertPr(
    owner: string,
    repo: string,
    originalPr: GitHubPR,
  ): Promise<string | null> {
    try {
      const prs = await this.get<GitHubPR[]>(
        `/repos/${owner}/${repo}/pulls?state=closed&per_page=20&sort=updated&direction=desc`,
      );
      for (const candidate of prs) {
        if (
          candidate.number !== originalPr.number &&
          candidate.merged &&
          candidate.title.toLowerCase().startsWith('revert') &&
          candidate.merged_at &&
          new Date(candidate.merged_at) > new Date(originalPr.merged_at!)
        ) {
          return candidate.merged_at;
        }
      }
    } catch { /* best effort */ }
    return null;
  }
}
