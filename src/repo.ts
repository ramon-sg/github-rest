/**
 * @file Which GitHub repo is meant: the one from `-R owner/repo`, the `GH_REPO` variable
 * (the one gh honors) or the directory's `origin`.
 */
import { spawnSync } from "node:child_process";

/**
 * GitHub URL of a remote: https, `git@host:` or `ssh://git@host/`, or the local git proxy of
 * Claude's cloud (`http://local_proxy@127.0.0.1:12345/git/owner/repo`), with or without `.git`.
 */
const ORIGIN_RE =
  /^(?:https:\/\/[^/]+\/|https?:\/\/[^/]+\/git\/|git@[^:]+:|ssh:\/\/git@[^/]+\/)([^/]+\/[^/]+?)(?:\.git)?$/;

/** Value of `GH_REPO`: `owner/repo` or `host/owner/repo`. */
const GH_REPO_RE = /^(?:[^/\s]+\/)?([^/\s]+\/[^/\s]+)$/;

/** Error for a `GH_REPO` that is not `[host/]owner/repo`. */
export class InvalidRepoEnvError extends Error {
  /** @param value - The value of `GH_REPO`. */
  constructor(readonly value: string) {
    super(`GH_REPO expects [host/]owner/repo: ${value}`);
    this.name = "InvalidRepoEnvError";
  }
}

/**
 * `owner/repo` of `GH_REPO`, the variable gh honors: the last two segments.
 * @param value - The variable's value, if set.
 * @returns The repo, or null if it is unset or empty.
 * @throws InvalidRepoEnvError if it is not `[host/]owner/repo`.
 * @example envRepo("github.com/acme/widgets") // "acme/widgets"
 */
export function envRepo(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  const match = GH_REPO_RE.exec(value);
  if (match === null) throw new InvalidRepoEnvError(value);
  return match[1] ?? null;
}

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
 * Repo to use, like gh: the one given by `-R`, then `GH_REPO`, then the origin's.
 * @param flag - Value of `-R`, if given.
 * @param cwd - Directory for the origin.
 * @param env - Environment with `GH_REPO`; the process's by default.
 * @returns The repo, or null if there is none.
 * @throws InvalidRepoEnvError if `GH_REPO` is not `[host/]owner/repo`.
 * @example resolveRepo(undefined, "/path/to/clone")
 */
export function resolveRepo(
  flag: string | undefined,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return flag ?? envRepo(env.GH_REPO) ?? originRepo(cwd);
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
