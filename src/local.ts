/**
 * @file What is on this machine for each issue: local branches and worktrees with `<n>-`,
 * after a `git fetch --prune` so branches already deleted on GitHub are not shown.
 */
import { spawnSync } from "node:child_process";
import { issueBranchRe } from "./match.js";

/** Local branches and worktrees of an issue. */
export interface Local {
  branches: string[];
  worktrees: { path: string; branch: string }[];
}

/**
 * Empty local state (outside a checkout of the repo).
 * @returns A new object.
 * @example emptyLocal() // { branches: [], worktrees: [] }
 */
export const emptyLocal = (): Local => ({ branches: [], worktrees: [] });

/**
 * Runs git and returns whether it succeeded and its stdout.
 * @param cwd - Directory.
 * @param args - Arguments.
 * @returns Result.
 */
function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: run.status === 0, out: run.stdout ?? "" };
}

/**
 * Worktrees with a branch from `git worktree list --porcelain`.
 * @param porcelain - The output.
 * @returns Path and branch of each one.
 */
function parseWorktrees(porcelain: string): { path: string; branch: string }[] {
  const found: { path: string; branch: string }[] = [];
  let path = "";
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    if (line.startsWith("branch refs/heads/"))
      found.push({ path, branch: line.slice("branch refs/heads/".length) });
  }
  return found;
}

/**
 * Local branches and worktrees of each issue, after `git fetch --prune origin`.
 * @param numbers - The issues.
 * @param cwd - The checkout.
 * @param warnings - Where the warning is added if the fetch fails.
 * @returns `{"<n>": Local}`.
 * @example localWork([42], "/path/to/clone", [])
 */
export function localWork(
  numbers: number[],
  cwd: string,
  warnings: string[],
): Record<string, Local> {
  if (!git(cwd, ["fetch", "-q", "--prune", "origin"]).ok) {
    warnings.push(
      "could not git fetch origin; local branches may be stale.",
    );
  }
  git(cwd, ["worktree", "prune"]);
  const heads = git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  ])
    .out.split("\n")
    .filter(Boolean);
  const worktrees = parseWorktrees(
    git(cwd, ["worktree", "list", "--porcelain"]).out,
  );
  return Object.fromEntries(
    numbers.map((n) => {
      const re = issueBranchRe(n);
      return [
        String(n),
        {
          branches: heads.filter((h) => re.test(h)),
          worktrees: worktrees.filter((w) => re.test(w.branch)),
        },
      ];
    }),
  );
}
