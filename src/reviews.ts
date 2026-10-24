/**
 * @file What a PR got back over REST: the checks of its head, its reviews and the comments
 * on its diff grouped by thread, and replying to one. Marking threads as resolved only
 * exists in GraphQL, so it is not here.
 */
import { failure, ghApi, ghGetAll, GitHubError } from "./gh.js";
import { toComment, type Comment } from "./issues.js";
import { getPr } from "./pulls.js";
import type {
  RestCheckRun,
  RestReview,
  RestReviewComment,
  RestStatus,
} from "./types.js";

/** Pages read at most for checks, reviews and comments. */
const MAX_PAGES = 10;

/** Group of a check, as `gh pr checks` calls it. */
export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

/** A check of the PR's head: a check run (Actions and apps) or a commit status. */
export interface Check {
  name: string;
  state: string;
  bucket: CheckBucket;
  link: string | null;
  kind: "check" | "status";
}

/** Bucket of each finished check run's conclusion; anything else is still pending. */
const CONCLUSION_BUCKET: Record<string, CheckBucket> = {
  success: "pass",
  neutral: "skipping",
  skipped: "skipping",
  failure: "fail",
  timed_out: "fail",
  action_required: "fail",
  startup_failure: "fail",
  cancelled: "cancel",
};

/** Bucket of each commit status state. */
const STATUS_BUCKET: Record<string, CheckBucket> = {
  success: "pass",
  failure: "fail",
  error: "fail",
  pending: "pending",
};

/**
 * A check run as a check: its conclusion if it finished, its status if not.
 * @param raw - The check run.
 * @returns The check.
 */
function fromCheckRun(raw: RestCheckRun): Check {
  const finished = raw.status === "completed" && raw.conclusion !== null;
  const state = finished ? (raw.conclusion as string) : raw.status;
  return {
    name: raw.name,
    state: state.toUpperCase(),
    bucket: finished ? (CONCLUSION_BUCKET[state] ?? "pending") : "pending",
    link: raw.html_url,
    kind: "check",
  };
}

/**
 * A commit status as a check.
 * @param raw - The status.
 * @returns The check.
 */
function fromStatus(raw: RestStatus): Check {
  return {
    name: raw.context,
    state: raw.state.toUpperCase(),
    bucket: STATUS_BUCKET[raw.state] ?? "pending",
    link: raw.target_url,
    kind: "status",
  };
}

/**
 * The checks of the PR's head commit: the latest run of each check plus the commit
 * statuses (CircleCI and other services that use them).
 * @param repo - `owner/repo`.
 * @param n - PR number.
 * @returns The head commit, the checks and whether a list was cut short.
 * @throws GitHubError if the PR does not exist or GitHub fails.
 * @example (await prChecks("acme/widgets", 9)).checks.filter((c) => c.bucket === "fail")
 */
export async function prChecks(
  repo: string,
  n: number,
): Promise<{ sha: string; checks: Check[]; truncated: boolean }> {
  const pr = await getPr(repo, n);
  if (pr === null)
    throw new GitHubError(`PR #${n} does not exist in ${repo}.`, 404);
  const runs = await ghGetAll(
    `repos/${repo}/commits/${pr.head}/check-runs`,
    MAX_PAGES,
    `the check runs of PR #${n}`,
    "check_runs",
  );
  const statuses = await ghGetAll(
    `repos/${repo}/commits/${pr.head}/status`,
    MAX_PAGES,
    `the statuses of PR #${n}`,
    "statuses",
  );
  return {
    sha: pr.head,
    checks: [
      ...(runs.items as RestCheckRun[]).map(fromCheckRun),
      ...(statuses.items as RestStatus[]).map(fromStatus),
    ],
    truncated: runs.truncated || statuses.truncated,
  };
}

/** A review of the PR. */
export interface Review {
  id: number;
  user: string | null;
  state: string;
  body: string;
  submittedAt: string | null;
  commit: string | null;
}

/**
 * The reviews of a PR, oldest first (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`…).
 * @param repo - `owner/repo`.
 * @param n - PR number.
 * @returns The reviews and whether the page ceiling cut the list short.
 * @throws GitHubError if GitHub fails.
 * @example await prReviews("acme/widgets", 9)
 */
export async function prReviews(
  repo: string,
  n: number,
): Promise<{ reviews: Review[]; truncated: boolean }> {
  const { items, truncated } = await ghGetAll(
    `repos/${repo}/pulls/${n}/reviews`,
    MAX_PAGES,
    `the reviews of PR #${n}`,
  );
  return {
    reviews: (items as RestReview[]).map((raw) => ({
      id: raw.id,
      user: raw.user?.login ?? null,
      state: raw.state,
      body: raw.body ?? "",
      submittedAt: raw.submitted_at ?? null,
      commit: raw.commit_id,
    })),
    truncated,
  };
}

/** A thread of comments on the PR's diff: its first comment and the replies. */
export interface Thread extends Comment {
  path: string;
  line: number | null;
  outdated: boolean;
  replies: Comment[];
}

/**
 * The comments on a PR's diff grouped by thread, oldest first. GitHub links every reply
 * to the thread's first comment; a reply whose first comment was deleted becomes its own
 * thread. `outdated` means the line no longer exists in the current diff (`line` is then
 * the original one). Whether a thread is resolved only exists in GraphQL.
 * @param repo - `owner/repo`.
 * @param n - PR number.
 * @returns The threads and whether the page ceiling cut the list short.
 * @throws GitHubError if GitHub fails.
 * @example (await prComments("acme/widgets", 9)).threads[0]?.replies
 */
export async function prComments(
  repo: string,
  n: number,
): Promise<{ threads: Thread[]; truncated: boolean }> {
  const { items, truncated } = await ghGetAll(
    `repos/${repo}/pulls/${n}/comments`,
    MAX_PAGES,
    `the review comments of PR #${n}`,
  );
  const raws = items as RestReviewComment[];
  const ids = new Set(raws.map((raw) => raw.id));
  const threads = new Map<number, Thread>();
  for (const raw of raws) {
    const root = raw.in_reply_to_id;
    if (root != null && ids.has(root)) continue;
    const outdated = raw.line === null && raw.subject_type !== "file";
    threads.set(raw.id, {
      ...toComment(raw),
      path: raw.path,
      line: raw.line ?? raw.original_line,
      outdated,
      replies: [],
    });
  }
  for (const raw of raws) {
    const root = raw.in_reply_to_id;
    if (root == null) continue;
    threads.get(root)?.replies.push(toComment(raw));
  }
  return { threads: [...threads.values()], truncated };
}

/**
 * Replies in the thread of a comment on the PR's diff. GitHub only accepts replies to the
 * thread's first comment, so if the id belongs to a reply, it replies to its first one.
 * @param repo - `owner/repo`.
 * @param n - PR number.
 * @param commentId - Id of a comment of the thread.
 * @param body - The reply.
 * @returns Id and URL of the reply.
 * @throws GitHubError if the comment does not exist or GitHub fails.
 * @example await replyToComment("acme/widgets", 9, 1234, "Fixed in abc123")
 */
export async function replyToComment(
  repo: string,
  n: number,
  commentId: number,
  body: string,
): Promise<{ id: number; url: string }> {
  const found = await ghApi("GET", `repos/${repo}/pulls/comments/${commentId}`);
  if (!found.ok) throw failure(found, `could not read comment ${commentId}`);
  const root =
    (found.data as RestReviewComment).in_reply_to_id ?? commentId;
  const res = await ghApi(
    "POST",
    `repos/${repo}/pulls/${n}/comments/${root}/replies`,
    { body },
  );
  if (!res.ok) throw failure(res, `could not reply to comment ${commentId}`);
  const raw = res.data as RestReviewComment;
  return { id: raw.id, url: raw.html_url };
}
