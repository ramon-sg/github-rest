/**
 * @file Which GitHub repo is meant: the one from `-R owner/repo` or the directory's `origin`.
 */
import { spawnSync } from "node:child_process";

/** GitHub URL of a remote: https, `git@host:` or `ssh://git@host/`, with or without `.git`. */
const ORIGIN_RE =
  /^(?:https:\/\/[^/]+\/|git@[^:]+:|ssh:\/\/git@[^/]+\/)([^/]+\/[^/]+?)(?:\.git)?$/;

/**
 * `owner/repo` of the `origin` remote, read raw from the config (without `insteadOf`, which
 * may point elsewhere).
 * @param cwd - Directory; the current one by default.
 * @returns The repo, or null if there is no GitHub origin.
 * @example originRepo("/path/to/clone") // "acme/widgets"
 */
export function originRepo(cwd = process.cwd()): string | null {
  const run = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd,
    encoding: "utf8",
  });
  if (run.status !== 0) return null;
  return ORIGIN_RE.exec(run.stdout.trim())?.[1] ?? null;
}

/**
 * Repo to use: the one given by `-R` or the origin's.
 * @param flag - Value of `-R`, if given.
 * @param cwd - Directory for the origin.
 * @returns The repo, or null if there is none.
 * @example resolveRepo(undefined, "/path/to/clone")
 */
export function resolveRepo(
  flag: string | undefined,
  cwd = process.cwd(),
): string | null {
  return flag ?? originRepo(cwd);
}

/**
 * Whether two `owner/repo` are the same (GitHub is case-insensitive).
 * @param a - One.
 * @param b - The other.
 * @returns Whether they are the same.
 * @example sameRepo("Acme/Widgets", "acme/widgets") // true
 */
export const sameRepo = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

/**
 * Whether the directory is a checkout of that repo: local branches are only looked at, and
 * fetch only runs, there.
 * @param repo - The repo.
 * @param cwd - Directory.
 * @returns Whether it is.
 * @example isCheckoutOf("acme/widgets", "/path/to/clone")
 */
export function isCheckoutOf(repo: string, cwd = process.cwd()): boolean {
  const origin = originRepo(cwd);
  return origin !== null && sameRepo(origin, repo);
}

/**
 * Owner and name of an `owner/repo`.
 * @param repo - The repo.
 * @returns Its parts.
 * @example splitRepo("acme/widgets") // { owner: "acme", name: "widgets" }
 */
export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, name };
}
