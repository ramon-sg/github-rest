/**
 * @file The work of one or more issues, with gh issue-work's JSON contract, built over REST:
 * the issue, its timeline, the repo's branches with `<n>-` and the PRs of each. Linked
 * branches come from an optional GraphQL query; without it, the output says `graphql: false`.
 */
import { GH_MISSING, ghApi, ghGetAll, graphql, GitHubError } from "./gh.js";
import { fetchIssue } from "./issues.js";
import { emptyLocal, type Local, localWork } from "./local.js";
import { closesIssue, issueBranchRe, refsIssue } from "./match.js";
import { findPrs, getPr, type Pr, type PrState } from "./pulls.js";
import { isCheckoutOf, sameRepo, splitRepo } from "./repo.js";
import type { RestIssue, RestRepo, RestTimelineEvent } from "./types.js";

/** Page ceiling for the repo's branches (100 per page). */
const MAX_BRANCH_PAGES = 10;

/** Page ceiling for an issue's timeline. */
const MAX_TIMELINE_PAGES = 20;

/** Warning when GitHub does not answer. */
const OFFLINE_WARNING =
  "could not reach GitHub (offline, or no 'gh auth login'?): showing only what is on this machine.";

/** A PR of the issue's work. */
export interface WorkPr {
  number: number;
  state: PrState;
  draft: boolean;
  branch: string;
  head: string;
  fork: boolean;
  closes: boolean;
}

/** A branch of the issue. */
export interface WorkBranch {
  name: string;
  remote: boolean;
  linked: boolean;
  merged: boolean;
}

/** The work of an issue. */
export interface IssueWork {
  number: number;
  state: "OPEN" | "CLOSED";
  assignees: string[];
  work: { prs: WorkPr[]; branches: WorkBranch[] };
  mentions: { number: number; state: PrState; branch: string }[];
  local: Local;
}

/** An issue in the output: its work, not found, or only the local state (offline). */
export type IssueEntry =
  | IssueWork
  | { number: number; error: "NOT_FOUND" }
  | { number: number; local: Local };

/** The output of `issue-work --json`. */
export interface WorkOutput {
  repo: string;
  defaultBranch: string | null;
  offline?: true;
  graphql?: false;
  issues: IssueEntry[];
}

/** What all issues in one read share. */
interface Context {
  repo: string;
  branches: string[];
  linked: Map<number, string[]> | null;
  local: Record<string, Local>;
  warnings: string[];
}

/**
 * Deduplicated by number and sorted, like jq's `unique_by(.number)`.
 * @param prs - The PRs.
 * @returns The PRs.
 */
const uniqueByNumber = (prs: Pr[]) =>
  [...new Map(prs.map((pr) => [pr.number, pr])).values()].sort(
    (a, b) => a.number - b.number,
  );

/**
 * Linked branches of each issue, in a single GraphQL query.
 * @param repo - `owner/repo`.
 * @param numbers - The issues.
 * @returns The branches per issue, or null if GraphQL does not answer.
 */
async function linkedBranches(
  repo: string,
  numbers: number[],
): Promise<Map<number, string[]> | null> {
  const { owner, name } = splitRepo(repo);
  const fields = numbers
    .map(
      (n) =>
        `i${n}: issue(number: ${n}) { linkedBranches(first: 20) { nodes { ref { name } } } }`,
    )
    .join(" ");
  const data = await graphql(
    `query LinkedBranches($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
    { owner, name },
  );
  if (data === null) return null;
  const repository = (data.repository ?? {}) as Record<
    string,
    { linkedBranches?: { nodes?: { ref?: { name?: string } | null }[] } } | null
  >;
  return new Map(
    numbers.map((n) => [
      n,
      (repository[`i${n}`]?.linkedBranches?.nodes ?? []).flatMap((node) =>
        node.ref?.name ? [node.ref.name] : [],
      ),
    ]),
  );
}

/**
 * PRs of this repo that name the issue in its timeline.
 * @param repo - `owner/repo`.
 * @param n - The issue.
 * @param warnings - Where the warning is added if the timeline was cut short.
 * @returns The PRs.
 * @throws GitHubError if GitHub fails.
 */
async function timelinePrs(
  repo: string,
  n: number,
  warnings: string[],
): Promise<Pr[]> {
  const timeline = await ghGetAll(
    `repos/${repo}/issues/${n}/timeline`,
    MAX_TIMELINE_PAGES,
    `the timeline of issue #${n}`,
  );
  if (timeline.truncated)
    warnings.push(`issue #${n}: could not fetch all the mentions.`);
  const suffix = `/repos/${repo}`.toLowerCase();
  const numbers = (timeline.items as RestTimelineEvent[]).flatMap((event) => {
    const source = event.source?.issue;
    const own = source?.repository_url?.toLowerCase().endsWith(suffix) ?? false;
    return event.event === "cross-referenced" &&
      source?.pull_request !== undefined &&
      own
      ? [source.number]
      : [];
  });
  const prs = await Promise.all(
    [...new Set(numbers)].map((number) => getPr(repo, number)),
  );
  return prs.filter(
    (pr): pr is Pr => pr !== null && sameRepo(pr.baseRepo, repo),
  );
}

/**
 * PRs of the repo's branches that belong to the issue.
 * @param repo - `owner/repo`.
 * @param refs - The branches.
 * @param warnings - Where the warning is added if a branch has too many PRs.
 * @returns The PRs.
 * @throws GitHubError if GitHub fails.
 */
async function branchPrs(
  repo: string,
  refs: string[],
  warnings: string[],
): Promise<Pr[]> {
  const found = await Promise.all(refs.map((ref) => findPrs(repo, ref)));
  found.forEach(({ truncated }, k) => {
    if (truncated)
      warnings.push(
        `branch ${refs[k]} has more than 20 PRs: only looking at the first ones.`,
      );
  });
  return found.flatMap(({ prs }) => prs);
}

/**
 * Builds the work of an issue from what was read, with the extension's rules.
 * @param issue - The issue.
 * @param refs - Repo branches with `<n>-`.
 * @param found - PRs of those branches (`byRef`) and of the timeline (`byTimeline`).
 * @param linked - Linked branches.
 * @param here - Local state.
 * @returns The work.
 */
function assemble(
  issue: RestIssue,
  refs: string[],
  found: { byRef: Pr[]; byTimeline: Pr[] },
  linked: string[],
  here: Local,
): IssueWork {
  const n = issue.number;
  const re = issueBranchRe(n);
  const work = uniqueByNumber([...found.byRef, ...found.byTimeline]).filter(
    (pr) => re.test(pr.branch) || refsIssue(pr.body, n),
  );
  const workNumbers = new Set(work.map((pr) => pr.number));
  const merged = new Set(
    work
      .filter((pr) => pr.state === "MERGED" && !pr.fork)
      .map((pr) => pr.branch),
  );
  const open = new Set(
    work.filter((pr) => pr.state === "OPEN").map((pr) => pr.branch),
  );
  const names = [
    ...new Set([
      ...linked,
      ...refs,
      ...work.filter((pr) => !pr.fork).map((pr) => pr.branch),
      ...here.branches,
    ]),
  ].sort();
  return {
    number: n,
    state: issue.state === "open" ? "OPEN" : "CLOSED",
    assignees: (issue.assignees ?? []).map(({ login }) => login),
    work: {
      prs: work.map((pr) => ({
        number: pr.number,
        state: pr.state,
        draft: pr.draft,
        branch: pr.branch,
        head: pr.head,
        fork: pr.fork,
        closes: closesIssue(pr.body, n),
      })),
      branches: names.map((name) => ({
        name,
        remote: refs.includes(name),
        linked: linked.includes(name),
        merged: merged.has(name) && !open.has(name),
      })),
    },
    mentions: uniqueByNumber(found.byTimeline)
      .filter((pr) => !workNumbers.has(pr.number))
      .map((pr) => ({ number: pr.number, state: pr.state, branch: pr.branch })),
    local: here,
  };
}

/**
 * The work of an issue, or NOT_FOUND.
 * @param ctx - The shared context.
 * @param n - The issue.
 * @returns Its entry.
 * @throws GitHubError if GitHub fails.
 */
async function issueEntry(ctx: Context, n: number): Promise<IssueEntry> {
  const issue = await fetchIssue(ctx.repo, n);
  if (issue === null) return { number: n, error: "NOT_FOUND" };
  const re = issueBranchRe(n);
  const refs = ctx.branches.filter((name) => re.test(name));
  const [byRef, byTimeline] = await Promise.all([
    branchPrs(ctx.repo, refs, ctx.warnings),
    timelinePrs(ctx.repo, n, ctx.warnings),
  ]);
  return assemble(
    issue,
    refs,
    { byRef, byTimeline },
    ctx.linked?.get(n) ?? [],
    ctx.local[String(n)] ?? emptyLocal(),
  );
}

/**
 * Reads the work of the issues with gh issue-work's contract. After reading the repo, every
 * call uses its current `full_name`, so a renamed repo still works.
 * @param asked - `owner/repo`, as given.
 * @param numbers - The issues; duplicates are removed and the order is kept.
 * @param opts - `cwd`: the directory, for local state (only if it is a checkout of the repo).
 * @returns The output and the warnings.
 * @throws GitHubError if gh is missing, the repo does not exist or GitHub fails midway.
 * @example await readWork("acme/widgets", [42])
 */
export async function readWork(
  asked: string,
  numbers: number[],
  opts: { cwd?: string } = {},
): Promise<{ output: WorkOutput; warnings: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const wanted = [...new Set(numbers)];
  const warnings: string[] = [];
  const local = isCheckoutOf(asked, cwd)
    ? localWork(wanted, cwd, warnings)
    : {};
  const repoRes = await ghApi("GET", `repos/${asked}`);
  if (repoRes.missingGh) throw new GitHubError(GH_MISSING, 0);
  if (repoRes.status === 404)
    throw new GitHubError(`repo ${asked} not found.`, 404);
  if (!repoRes.ok) {
    warnings.push(OFFLINE_WARNING);
    const issues = wanted.map((n) => ({
      number: n,
      local: local[String(n)] ?? emptyLocal(),
    }));
    return {
      output: { repo: asked, defaultBranch: null, offline: true, issues },
      warnings,
    };
  }
  const info = repoRes.data as RestRepo;
  const repo = info.full_name;
  const branches = await ghGetAll(
    `repos/${repo}/branches`,
    MAX_BRANCH_PAGES,
    `the branches of ${repo}`,
  );
  if (branches.truncated)
    warnings.push(
      `${repo} has more than ${MAX_BRANCH_PAGES * 100} branches: only looking at the first ones.`,
    );
  const ctx: Context = {
    repo,
    branches: (branches.items as { name: string }[]).map((b) => b.name),
    linked: await linkedBranches(repo, wanted),
    local,
    warnings,
  };
  const issues: IssueEntry[] = [];
  for (const n of wanted) issues.push(await issueEntry(ctx, n));
  const output: WorkOutput = {
    repo,
    defaultBranch: info.default_branch,
    ...(ctx.linked === null ? { graphql: false as const } : {}),
    issues,
  };
  return { output, warnings };
}
