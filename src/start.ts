/**
 * @file `issue-work start`: creates a branch for the issue on GitHub over REST. It is not
 * linked to the issue (the Development panel): only the other API links branches. If the
 * directory is a checkout of the repo, it fetches it into `refs/remotes/origin/<branch>`
 * without creating a local branch.
 */
import { spawnSync } from "node:child_process";
import { failure, ghApi, GitHubError } from "./gh.js";
import { fetchIssue } from "./issues.js";
import { isCheckoutOf } from "./repo.js";
import type { RestRepo } from "./types.js";

/** What `start` prints. */
export interface StartResult {
  repo: string;
  branch: string;
  base: string;
  oid: string;
}

/**
 * The commit of a GitHub branch. Each segment of the name is encoded (`#` or `%` would
 * otherwise break the path).
 * @param repo - `owner/repo`.
 * @param branch - The branch.
 * @returns The oid, or null if it does not exist.
 * @throws GitHubError if GitHub fails for another reason.
 */
async function branchOid(repo: string, branch: string): Promise<string | null> {
  const path = branch.split("/").map(encodeURIComponent).join("/");
  const res = await ghApi("GET", `repos/${repo}/git/ref/heads/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw failure(res, `could not read branch ${branch}`);
  // NOTE: what matters for "exists" is the 200; the sha may be missing in minimal responses.
  return (res.data as { object?: { sha?: string } }).object?.sha ?? "";
}

/**
 * Creates the branch over REST.
 * @param repo - The repo.
 * @param branch - The branch.
 * @param oid - From which commit.
 * @throws GitHubError if it could not be created.
 */
async function createBranch(
  repo: RestRepo,
  branch: string,
  oid: string,
): Promise<void> {
  const res = await ghApi("POST", `repos/${repo.full_name}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: oid,
  });
  if (!res.ok)
    throw failure(
      res,
      `could not create branch ${branch} in ${repo.full_name} (no push permission?)`,
    );
}

/**
 * Creates the branch of an issue on GitHub and, in a checkout of the repo, fetches it.
 * @param repo - `owner/repo`.
 * @param n - The issue.
 * @param branch - The new branch.
 * @param opts - `base` (the default branch if omitted) and `cwd`.
 * @returns What was created and the warnings.
 * @throws GitHubError if the branch already exists, the issue or the base is missing, or it could not be created.
 * @example await startBranch("acme/widgets", 42, "feat/42-x")
 */
export async function startBranch(
  repo: string,
  n: number,
  branch: string,
  opts: { base?: string; cwd?: string } = {},
): Promise<{ result: StartResult; warnings: string[] }> {
  const warnings: string[] = [];
  const repoRes = await ghApi("GET", `repos/${repo}`);
  if (!repoRes.ok) throw failure(repoRes, `could not read ${repo} on GitHub`);
  const info = repoRes.data as RestRepo;
  if ((await branchOid(repo, branch)) !== null)
    throw new GitHubError(
      `branch ${branch} already exists in ${repo}.`,
      422,
    );
  const issue = await fetchIssue(repo, n);
  if (issue === null)
    throw new GitHubError(`issue #${n} does not exist in ${repo}.`, 404);
  const base = opts.base ?? info.default_branch;
  const oid = await branchOid(repo, base);
  if (oid === null)
    throw new GitHubError(`base branch ${base} does not exist in ${repo}.`, 404);
  await createBranch(info, branch, oid);
  const cwd = opts.cwd ?? process.cwd();
  if (isCheckoutOf(repo, cwd)) {
    const fetch = spawnSync(
      "git",
      [
        "fetch",
        "-q",
        "origin",
        `refs/heads/${branch}:refs/remotes/origin/${branch}`,
      ],
      { cwd },
    );
    if (fetch.status !== 0)
      warnings.push(
        "created the branch on GitHub, but could not fetch it with git fetch.",
      );
  }
  return { result: { repo, branch, base, oid }, warnings };
}
