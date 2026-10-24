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

/** A comment of an issue or PR conversation (`GET repos/{r}/issues/{n}/comments`). */
export interface RestComment {
  id: number;
  user: { login: string } | null;
  body: string | null;
  html_url: string;
  created_at: string;
}

/** A review comment on a PR's diff (`GET repos/{r}/pulls/{n}/comments`). */
export interface RestReviewComment extends RestComment {
  in_reply_to_id?: number | null;
  path: string;
  line: number | null;
  original_line: number | null;
  subject_type?: "line" | "file";
}

/** A review of a PR (`GET repos/{r}/pulls/{n}/reviews`). */
export interface RestReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  submitted_at?: string | null;
  commit_id: string | null;
}

/** A label of the repo (`GET repos/{r}/labels`). */
export interface RestLabel {
  name: string;
  color: string;
  description: string | null;
}

/** A check run of a commit (`GET repos/{r}/commits/{sha}/check-runs`). */
export interface RestCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
}

/** A commit status (`GET repos/{r}/commits/{sha}/status`, field `statuses`). */
export interface RestStatus {
  context: string;
  state: string;
  target_url: string | null;
}
