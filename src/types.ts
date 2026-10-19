/**
 * @file What is read from GitHub's REST responses: only the fields the package uses.
 */

/** A repo (`GET repos/{r}`). */
export interface RestRepo {
  full_name: string;
  default_branch: string;
  node_id: string;
}

/** An issue (`GET repos/{r}/issues/{n}`); has `pull_request` if the number belongs to a PR. */
export interface RestIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  body: string | null;
  html_url: string;
  node_id: string;
  labels: (string | { name?: string })[];
  assignees: { login: string }[] | null;
  pull_request?: unknown;
}

/** A PR (`GET repos/{r}/pulls/{n}`); `head.repo` is null if the fork was deleted. */
export interface RestPull {
  number: number;
  state: "open" | "closed";
  merged_at: string | null;
  draft?: boolean;
  body: string | null;
  html_url: string;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { repo: { full_name: string } };
}

/** A timeline event of an issue; only `cross-referenced` ones matter. */
export interface RestTimelineEvent {
  event?: string;
  source?: {
    issue?: { number: number; repository_url?: string; pull_request?: unknown };
  };
}
