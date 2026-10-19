/**
 * @file Issues over REST: read one with the fields `gh issue view --json` used, and assign it.
 */
import { failure, ghApi, GitHubError } from "./gh.js";
import type { RestIssue } from "./types.js";

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
  if (raw === null) return null;
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
async function currentLogin(): Promise<string> {
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
  const assignees = await Promise.all(
    logins.map((login) => (login === "@me" ? currentLogin() : login)),
  );
  const res = await ghApi("POST", `repos/${repo}/issues/${n}/assignees`, {
    assignees,
  });
  if (!res.ok) throw failure(res, `could not assign issue #${n}`);
  const got = new Set(
    ((res.data as RestIssue | null)?.assignees ?? []).map(({ login }) =>
      login.toLowerCase(),
    ),
  );
  const missing = assignees.filter((login) => !got.has(login.toLowerCase()));
  if (missing.length > 0)
    throw new GitHubError(
      `could not assign ${missing.join(", ")} to issue #${n} (GitHub ignored it)`,
      res.status,
    );
}
