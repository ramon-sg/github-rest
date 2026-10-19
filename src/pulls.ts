/**
 * @file PRs over REST: read, find by branch, create and edit, with the state as in GraphQL
 * (`OPEN`, `CLOSED`, `MERGED`).
 */
import { failure, ghApi } from "./gh.js";
import { sameRepo, splitRepo } from "./repo.js";
import type { RestPull } from "./types.js";

/** State of a PR as GraphQL gives it. */
export type PrState = "OPEN" | "CLOSED" | "MERGED";

/** A PR with what the package uses. */
export interface Pr {
  number: number;
  state: PrState;
  draft: boolean;
  branch: string;
  head: string;
  fork: boolean;
  body: string;
  baseRepo: string;
  url: string;
}

/** How many PRs are looked at per branch (as in the extension). */
export const PRS_PER_BRANCH = 20;

/**
 * A REST PR with the GraphQL state: `MERGED` if it has `merged_at`.
 * @param raw - The REST PR.
 * @returns The PR.
 * @example toPr(raw).state // "MERGED"
 */
export function toPr(raw: RestPull): Pr {
  const merged = raw.merged_at !== null;
  return {
    number: raw.number,
    state: merged ? "MERGED" : raw.state === "open" ? "OPEN" : "CLOSED",
    draft: raw.draft ?? false,
    branch: raw.head.ref,
    head: raw.head.sha,
    fork:
      raw.head.repo === null ||
      !sameRepo(raw.head.repo.full_name, raw.base.repo.full_name),
    body: raw.body ?? "",
    baseRepo: raw.base.repo.full_name,
    url: raw.html_url,
  };
}

/**
 * What `pr find` and `pr view` print: the fields of `gh pr … --json`.
 * @param pr - The PR.
 * @returns Its fields.
 * @example prView(pr).headRefOid
 */
export const prView = (pr: Pr) => ({
  number: pr.number,
  state: pr.state,
  headRefOid: pr.head,
  body: pr.body,
  url: pr.url,
});

/**
 * A PR by number.
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @returns The PR, or null if it does not exist.
 * @throws GitHubError if GitHub fails for another reason.
 * @example await getPr("acme/widgets", 7)
 */
export async function getPr(repo: string, n: number): Promise<Pr | null> {
  const res = await ghApi("GET", `repos/${repo}/pulls/${n}`);
  if (res.status === 404) return null;
  if (!res.ok) throw failure(res, `could not read PR #${n}`);
  return toPr(res.data as RestPull);
}

/**
 * The PRs of a branch of the repo (not from forks), newest to oldest.
 * @param repo - `owner/repo`.
 * @param branch - The branch.
 * @returns The PRs and whether the list was cut at `PRS_PER_BRANCH`.
 * @throws GitHubError if GitHub fails.
 * @example await findPrs("acme/widgets", "feat/42-x")
 */
export async function findPrs(
  repo: string,
  branch: string,
): Promise<{ prs: Pr[]; truncated: boolean }> {
  const head = encodeURIComponent(`${splitRepo(repo).owner}:${branch}`);
  const res = await ghApi(
    "GET",
    `repos/${repo}/pulls?head=${head}&state=all&per_page=${PRS_PER_BRANCH}`,
  );
  if (!res.ok || !Array.isArray(res.data))
    throw failure(res, `could not search the PRs of ${branch}`);
  return {
    prs: (res.data as RestPull[]).map(toPr),
    truncated: res.data.length >= PRS_PER_BRANCH,
  };
}

/**
 * The newest PR of a branch.
 * @param repo - `owner/repo`.
 * @param branch - The branch.
 * @returns The PR, or null if the branch has none.
 * @throws GitHubError if GitHub fails.
 * @example await findPr("acme/widgets", "feat/42-x")
 */
export async function findPr(repo: string, branch: string): Promise<Pr | null> {
  return (await findPrs(repo, branch)).prs[0] ?? null;
}

/** What is needed to open a PR. */
export interface NewPr {
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

/**
 * Opens a PR.
 * @param repo - `owner/repo`.
 * @param pr - Head, base, title, body and whether it is a draft.
 * @returns Number and URL.
 * @throws GitHubError if GitHub fails.
 * @example await createPr("acme/widgets", { head: "feat/42-x", base: "main", title: "T", body: "", draft: true })
 */
export async function createPr(
  repo: string,
  pr: NewPr,
): Promise<{ number: number; url: string }> {
  const res = await ghApi("POST", `repos/${repo}/pulls`, {
    head: pr.head,
    base: pr.base,
    title: pr.title,
    body: pr.body,
    draft: pr.draft ?? false,
  });
  if (!res.ok) throw failure(res, `could not open the PR for ${pr.head}`);
  const raw = res.data as RestPull;
  return { number: raw.number, url: raw.html_url };
}

/** Changes to a PR. */
export interface PrChange {
  body?: string;
  state?: "open" | "closed";
}

/**
 * Changes the body or state of a PR.
 * @param repo - `owner/repo`.
 * @param n - Number.
 * @param change - What changes.
 * @throws GitHubError if GitHub fails.
 * @example await updatePr("acme/widgets", 9, { state: "open" })
 */
export async function updatePr(
  repo: string,
  n: number,
  change: PrChange,
): Promise<void> {
  const res = await ghApi("PATCH", `repos/${repo}/pulls/${n}`, change);
  if (!res.ok) throw failure(res, `could not edit PR #${n}`);
}
