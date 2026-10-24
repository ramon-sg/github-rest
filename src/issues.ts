/**
 * @file Issues over REST: read, list, create and edit them, assign them, and read or add
 * comments. The fields are the ones `gh issue … --json` used.
 */
import { failure, ghApi, ghGetAll, GitHubError, PAGE_SIZE } from "./gh.js";
import type { RestComment, RestIssue } from "./types.js";

/** An issue with the field names of `gh issue view --json`. */
export interface IssueView {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  body: string;
  url: string;
  labels: { name: string }[];
  assignees: { login: string }[];
}

/**
 * The raw issue, or null if it does not exist or the number belongs to a PR (REST mixes them).
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @returns The issue, or null.
 * @throws GitHubError if GitHub fails for another reason.
 * @example await fetchIssue("acme/widgets", 42)
 */
export async function fetchIssue(
  repo: string,
  n: number,
): Promise<RestIssue | null> {
  const res = await ghApi("GET", `repos/${repo}/issues/${n}`);
  if (res.status === 404) return null;
  if (!res.ok) throw failure(res, `could not read issue #${n}`);
  const raw = res.data as RestIssue;
  return raw.pull_request === undefined ? raw : null;
}

/**
 * The issue with the fields of `gh issue view --json number,title,labels,state,body,assignees,url`.
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @returns The issue, or null if it does not exist.
 * @throws GitHubError if GitHub fails.
 * @example await viewIssue("acme/widgets", 42)
 */
export async function viewIssue(
  repo: string,
  n: number,
): Promise<IssueView | null> {
  const raw = await fetchIssue(repo, n);
  return raw === null ? null : toIssueView(raw);
}

/**
 * A REST issue with the fields of `gh issue view --json`.
 * @param raw - The REST issue.
 * @returns The issue.
 * @example toIssueView(raw).state // "OPEN"
 */
export function toIssueView(raw: RestIssue): IssueView {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state === "open" ? "OPEN" : "CLOSED",
    body: raw.body ?? "",
    url: raw.html_url,
    labels: raw.labels.map((label) => ({
      name: typeof label === "string" ? label : (label.name ?? ""),
    })),
    assignees: (raw.assignees ?? []).map(({ login }) => ({ login })),
  };
}

/**
 * Login of the gh account, for `@me`.
 * @returns The login.
 * @throws GitHubError if GitHub does not say (in the cloud, the proxy may deny `GET user`).
 */
export async function currentLogin(): Promise<string> {
  const res = await ghApi("GET", "user");
  const login = (res.data as { login?: unknown } | null)?.login;
  if (!res.ok || typeof login !== "string")
    throw failure(res, "can't tell who you are on GitHub (needed for @me)");
  return login;
}

/**
 * Adds people to the issue; `@me` is the gh account. GitHub answers 201 and silently skips
 * whoever cannot be assigned, so the response's assignees are checked.
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @param logins - Logins, with `@me` if needed.
 * @throws GitHubError if GitHub fails or ignores someone.
 * @example await assign("acme/widgets", 42, ["@me"])
 */
export async function assign(
  repo: string,
  n: number,
  logins: string[],
): Promise<void> {
  const assignees = await resolveLogins(logins);
  const res = await ghApi("POST", `repos/${repo}/issues/${n}/assignees`, {
    assignees,
  });
  if (!res.ok) throw failure(res, `could not assign issue #${n}`);
  const missing = ignoredLogins(res.data as RestIssue | null, assignees);
  if (missing.length > 0)
    throw new GitHubError(
      `could not assign ${missing.join(", ")} to issue #${n} (GitHub ignored it)`,
      res.status,
    );
}

/**
 * The logins with `@me` replaced by the gh account, asked for only once.
 * @param logins - Logins, with `@me` if needed.
 * @returns The logins.
 * @throws GitHubError if `@me` is used and GitHub does not say who you are.
 */
async function resolveLogins(logins: string[]): Promise<string[]> {
  if (!logins.includes("@me")) return logins;
  const me = await currentLogin();
  return logins.map((login) => (login === "@me" ? me : login));
}

/**
 * Who GitHub left out of an issue's assignees: it skips, without an error, whoever cannot
 * be assigned.
 * @param raw - The issue GitHub answered with.
 * @param wanted - The logins that were asked for.
 * @returns The ones missing, as they were asked for.
 */
function ignoredLogins(raw: RestIssue | null, wanted: string[]): string[] {
  const got = new Set(
    (raw?.assignees ?? []).map(({ login }) => login.toLowerCase()),
  );
  return wanted.filter((login) => !got.has(login.toLowerCase()));
}

/** What is needed to open an issue. */
export interface NewIssue {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

/**
 * Opens an issue. If GitHub leaves someone out of the assignees, the issue is already
 * created, so it is a warning and not an error.
 * @param repo - `owner/repo`.
 * @param issue - Title, body, labels and assignees (`@me` is the gh account).
 * @returns Number, URL and warnings.
 * @throws GitHubError if GitHub fails.
 * @example await createIssue("acme/widgets", { title: "T", body: "B", labels: ["bug"] })
 */
export async function createIssue(
  repo: string,
  issue: NewIssue,
): Promise<{ number: number; url: string; warnings: string[] }> {
  const assignees = await resolveLogins(issue.assignees ?? []);
  const res = await ghApi("POST", `repos/${repo}/issues`, {
    title: issue.title,
    body: issue.body,
    labels: issue.labels ?? [],
    assignees,
  });
  if (!res.ok) throw failure(res, "could not create the issue");
  const raw = res.data as RestIssue;
  const missing = ignoredLogins(raw, assignees);
  const warnings =
    missing.length === 0
      ? []
      : [`GitHub did not assign ${missing.join(", ")} to issue #${raw.number}.`];
  return { number: raw.number, url: raw.html_url, warnings };
}

/** Changes to an issue. */
export interface IssueChange {
  title?: string;
  body?: string;
  state?: "open" | "closed";
  addLabels?: string[];
  removeLabels?: string[];
}

/** What GitHub says when the label to remove is not on the issue. */
const LABEL_NOT_ON_ISSUE = "Label does not exist";

/**
 * Changes an issue: title, body and state in one call, then the labels to add and the
 * ones to remove. Removing a label the issue does not have is not an error, as in gh.
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @param change - What changes.
 * @throws GitHubError if GitHub fails.
 * @example await editIssue("acme/widgets", 42, { addLabels: ["bug"], state: "closed" })
 */
export async function editIssue(
  repo: string,
  n: number,
  change: IssueChange,
): Promise<void> {
  const { addLabels = [], removeLabels = [], ...fields } = change;
  if (Object.keys(fields).length > 0) {
    const res = await ghApi("PATCH", `repos/${repo}/issues/${n}`, fields);
    if (!res.ok) throw failure(res, `could not edit issue #${n}`);
  }
  if (addLabels.length > 0) {
    const res = await ghApi("POST", `repos/${repo}/issues/${n}/labels`, {
      labels: addLabels,
    });
    if (!res.ok) throw failure(res, `could not add labels to issue #${n}`);
  }
  for (const label of removeLabels) {
    const res = await ghApi(
      "DELETE",
      `repos/${repo}/issues/${n}/labels/${encodeURIComponent(label)}`,
    );
    const absent =
      res.status === 404 &&
      (res.data as { message?: unknown } | null)?.message ===
        LABEL_NOT_ON_ISSUE;
    if (!res.ok && !absent)
      throw failure(res, `could not remove ${label} from issue #${n}`);
  }
}

/** Filters of `listIssues`. */
export interface IssueFilter {
  state?: "open" | "closed" | "all";
  labels?: string[];
  missingHeading?: string;
  limit?: number;
}

/** Issues a list returns when no limit is given. */
export const DEFAULT_ISSUE_LIMIT = 100;

/** Pages a list reads at most, to bound how much of a big repo is scanned. */
export const MAX_ISSUE_PAGES = 10;

/**
 * The issues of the repo, newest first, without PRs (REST mixes them). `missingHeading`
 * keeps only those whose body does not contain that text, such as `**Rama sugerida**`;
 * GitHub cannot filter by body, so it is done here, reading page by page until `limit`
 * issues match or `MAX_ISSUE_PAGES` pages were read.
 * @param repo - `owner/repo`.
 * @param filter - State (open by default), labels (all must match), heading and limit.
 * @returns The issues and whether the page ceiling cut the list short.
 * @throws GitHubError if the first page fails.
 * @example await listIssues("acme/widgets", { missingHeading: "**Rama sugerida**" })
 */
export async function listIssues(
  repo: string,
  filter: IssueFilter = {},
): Promise<{ issues: IssueView[]; truncated: boolean }> {
  const limit = filter.limit ?? DEFAULT_ISSUE_LIMIT;
  const query = new URLSearchParams({ state: filter.state ?? "open" });
  if (filter.labels !== undefined && filter.labels.length > 0)
    query.set("labels", filter.labels.join(","));
  const issues: IssueView[] = [];
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const res = await ghApi(
      "GET",
      `repos/${repo}/issues?${query}&per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!res.ok || !Array.isArray(res.data)) {
      if (page === 1) throw failure(res, `could not list the issues of ${repo}`);
      return { issues, truncated: true };
    }
    for (const raw of res.data as RestIssue[]) {
      if (raw.pull_request !== undefined) continue;
      if (
        filter.missingHeading !== undefined &&
        (raw.body ?? "").includes(filter.missingHeading)
      )
        continue;
      issues.push(toIssueView(raw));
      if (issues.length >= limit) return { issues, truncated: false };
    }
    if (res.data.length < PAGE_SIZE) return { issues, truncated: false };
  }
  return { issues, truncated: true };
}

/** A comment of an issue or PR conversation. */
export interface Comment {
  id: number;
  user: string | null;
  body: string;
  url: string;
  createdAt: string;
}

/** Pages of comments read at most (1000 comments). */
const MAX_COMMENT_PAGES = 10;

/**
 * A REST comment with what the package prints.
 * @param raw - The REST comment.
 * @returns The comment.
 * @example toComment(raw).user // "ana"
 */
export function toComment(raw: RestComment): Comment {
  return {
    id: raw.id,
    user: raw.user?.login ?? null,
    body: raw.body ?? "",
    url: raw.html_url,
    createdAt: raw.created_at,
  };
}

/**
 * The conversation comments of an issue, or of a PR (not the ones on its diff), oldest
 * first.
 * @param repo - `owner/repo`.
 * @param n - Issue or PR number.
 * @returns The comments and whether the page ceiling cut the list short.
 * @throws GitHubError if GitHub fails.
 * @example await issueComments("acme/widgets", 42)
 */
export async function issueComments(
  repo: string,
  n: number,
): Promise<{ comments: Comment[]; truncated: boolean }> {
  const { items, truncated } = await ghGetAll(
    `repos/${repo}/issues/${n}/comments`,
    MAX_COMMENT_PAGES,
    `the comments of #${n}`,
  );
  return { comments: (items as RestComment[]).map(toComment), truncated };
}

/**
 * Adds a comment to the conversation of an issue or PR.
 * @param repo - `owner/repo`.
 * @param n - Issue or PR number.
 * @param body - The comment.
 * @returns Id and URL of the comment.
 * @throws GitHubError if GitHub fails.
 * @example await addComment("acme/widgets", 42, "Done in #43")
 */
export async function addComment(
  repo: string,
  n: number,
  body: string,
): Promise<{ id: number; url: string }> {
  const res = await ghApi("POST", `repos/${repo}/issues/${n}/comments`, {
    body,
  });
  if (!res.ok) throw failure(res, `could not comment on #${n}`);
  const raw = res.data as RestComment;
  return { id: raw.id, url: raw.html_url };
}
