/**
 * @file GitHub transport: every call goes through `gh api`, which in Claude's cloud is the
 * only thing the proxy authenticates and on a regular machine uses the `gh` session. Only
 * REST endpoints: the cloud's proxy answers 403 to the other API.
 */
import { spawn } from "node:child_process";

/** HTTP method of a call. */
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Result of `gh api`: `status` is the HTTP code, or 0 if there was no response (offline).
 * `missingGh` is set when gh itself could not be run, which is not the same as offline.
 */
export interface GhResult {
  ok: boolean;
  status: number;
  data: unknown;
  stderr: string;
  missingGh?: true;
}

/** Message when the `gh` binary is not in PATH. */
export const GH_MISSING = "gh not found in PATH";

/** Page size of REST lists, the maximum GitHub accepts. */
export const PAGE_SIZE = 100;

/** HTTP code in a `gh api` error (`gh: Not Found (HTTP 404)`). */
const HTTP_STATUS = /HTTP (\d{3})/;

/** GitHub error to show the user, with its HTTP code (0 if there was no response). */
export class GitHubError extends Error {
  /**
   * @param message - What failed.
   * @param status - HTTP code, or 0.
   */
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * JSON of an output, or null if it is not JSON (gh with no response, for example).
 * @param text - The output.
 * @returns The parsed value.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Calls `gh api` over REST. The body goes through stdin as JSON, so types do not depend on
 * gh's `-f`/`-F` flags.
 * @param method - HTTP method.
 * @param path - Path without a leading `/`, with its query (`repos/o/r/issues/1`).
 * @param body - Body, if the call has one.
 * @returns The result; never throws.
 * @example await ghApi("GET", "repos/acme/widgets")
 */
export function ghApi(
  method: Method,
  path: string,
  body?: unknown,
): Promise<GhResult> {
  const args = ["api", "--method", method, path];
  if (body !== undefined) args.push("--input", "-");
  return new Promise((resolve) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) =>
      resolve(
        error.code === "ENOENT"
          ? {
              ok: false,
              status: 0,
              data: null,
              stderr: GH_MISSING,
              missingGh: true,
            }
          : { ok: false, status: 0, data: null, stderr: error.message },
      ),
    );
    child.on("close", (code) => {
      const data = parseJson(out);
      if (code === 0)
        return resolve({ ok: true, status: 200, data, stderr: err });
      const match = HTTP_STATUS.exec(err);
      resolve({
        ok: false,
        status: match ? Number(match[1]) : 0,
        data,
        stderr: err,
      });
    });
    // WHY: if gh does not exist, writing to its stdin raises EPIPE; the 'error' handler above already resolves.
    child.stdin.on("error", () => undefined);
    child.stdin.end(body === undefined ? "" : JSON.stringify(body));
  });
}

/**
 * Readable error from a failed result: what was being attempted and gh's first line.
 * @param res - The result.
 * @param what - What was being attempted, lowercase ("could not read issue #4").
 * @returns The error, with the HTTP code.
 * @example throw failure(res, "could not read the repo")
 */
export function failure(res: GhResult, what: string): GitHubError {
  const detail = res.stderr.trim().split("\n")[0] || "no detail";
  return new GitHubError(`${what}: ${detail}`, res.status);
}

/**
 * Reads a paginated REST list, 100 at a time, up to `maxPages` pages. If the first page
 * fails it throws; if a later one fails or the ceiling is reached, it returns what it has
 * with `truncated`.
 * @param path - Path of the list, with or without a query.
 * @param maxPages - Page ceiling.
 * @param what - What is being read, for the error ("the branches of acme/widgets").
 * @param key - Field that holds the list when the page is an object
 *   (`check_runs` in `{total_count, check_runs}`); without it the page is the list.
 * @returns The items and whether the list was cut short.
 * @throws GitHubError if the first page fails.
 * @example await ghGetAll("repos/acme/widgets/branches", 10, "the branches")
 */
export async function ghGetAll(
  path: string,
  maxPages: number,
  what: string,
  key?: string,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await ghApi(
      "GET",
      `${path}${sep}per_page=${PAGE_SIZE}&page=${page}`,
    );
    const list =
      key === undefined
        ? res.data
        : (res.data as Record<string, unknown> | null)?.[key];
    if (!res.ok || !Array.isArray(list)) {
      if (page === 1) throw failure(res, `could not read ${what}`);
      return { items, truncated: true };
    }
    items.push(...list);
    if (list.length < PAGE_SIZE) return { items, truncated: false };
  }
  return { items, truncated: true };
}
