/**
 * @file `issue-work start`: creates a branch for the issue on GitHub, linked (GraphQL) if
 * GitHub allows it and otherwise over REST, unlinked. If the directory is a checkout of the
 * repo, it fetches it into `refs/remotes/origin/<branch>` without creating a local branch.
 */
import { spawnSync } from "node:child_process";
import { failure, ghApi, graphql, GitHubError } from "./gh.js";
import { fetchIssue } from "./issues.js";
import { isCheckoutOf } from "./repo.js";
import type { RestRepo } from "./types.js";

/** What `start` prints. */
export interface StartResult {
  repo: string;
  branch: string;
  base: string;
  oid: string;
  linked: boolean;
}

/** Mutation that creates the branch already linked to the issue. */
const CREATE_LINKED = `mutation CreateLinkedBranch($issueId: ID!, $repositoryId: ID!, $oid: GitObjectID!, $name: String!) {
  createLinkedBranch(input: { issueId: $issueId, repositoryId: $repositoryId, oid: $oid, name: $name }) { linkedBranch { ref { name } } }
}`;

/**
 * The commit of a GitHub branch.
 * @param repo - `owner/repo`.
 * @param branch - The branch.
 * @returns The oid, or null if it does not exist.
 * @throws GitHubError if GitHub fails for another reason.
 */
async function branchOid(repo: string, branch: string): Promise<string | null> {
  const res = await ghApi("GET", `repos/${repo}/git/ref/heads/${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw failure(res, `could not read branch ${branch}`);
  // NOTE: what matters for "exists" is the 200; the sha may be missing in minimal responses.
  return (res.data as { object?: { sha?: string } }).object?.sha ?? "";
}

/**
 * Creates the branch linked to the issue; if GraphQL does not answer, over REST unlinked.
 * @param repo - The repo, with its node_id.
 * @param issueId - node_id of the issue.
 * @param branch - The branch.
 * @param oid - From which commit.
 * @returns Whether it ended up linked.
 * @throws GitHubError if it could not be created either way.
 */
async function createBranch(
  repo: RestRepo,
  issueId: string,
  branch: string,
  oid: string,
): Promise<boolean> {
  const data = await graphql(CREATE_LINKED, {
    issueId,
    repositoryId: repo.node_id,
    oid,
    name: branch,
  });
  const linked = (
    data?.createLinkedBranch as { linkedBranch?: unknown } | null | undefined
  )?.linkedBranch;
  if (linked !== undefined && linked !== null) return true;
  const res = await ghApi("POST", `repos/${repo.full_name}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: oid,
  });
  if (!res.ok)
    throw failure(
      res,
      `could not create branch ${branch} in ${repo.full_name} (no push permission?)`,
    );
  return false;
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
      `branch ${branch} already exists in ${repo}: GitHub only links new branches.`,
      422,
    );
  const issue = await fetchIssue(repo, n);
  if (issue === null)
    throw new GitHubError(`issue #${n} does not exist in ${repo}.`, 404);
  const base = opts.base ?? info.default_branch;
  const oid = await branchOid(repo, base);
  if (oid === null)
    throw new GitHubError(`base branch ${base} does not exist in ${repo}.`, 404);
  const linked = await createBranch(info, issue.node_id, branch, oid);
  if (!linked)
    warnings.push(
      `could not link the branch to issue #${n}; created it unlinked.`,
    );
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
  return { result: { repo, branch, base, oid, linked }, warnings };
}
