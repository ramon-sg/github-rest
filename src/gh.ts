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
  /** Response headers with lowercase names; only when the call asked for them. */
  headers?: Record<string, string>;
}

/** Options of a call. */
export interface GhOptions {
  /** Also read the response headers (`gh api -i`). */
  include?: boolean;
}

/** Message when the `gh` binary is not in PATH. */
export const GH_MISSING = "gh not found in PATH";

/** Page size of REST lists, the maximum GitHub accepts. */
export const PAGE_SIZE = 100;

/** HTTP code in a `gh api` error (`gh: Not Found (HTTP 404)`). */
const HTTP_STATUS = /HTTP (\d{3})/;

/** Status line that `gh api -i` prints first (`HTTP/2.0 200 OK`). */
const STATUS_LINE = /^HTTP\/\S+ (\d{3})/;

/** End of the headers in `gh api -i` output: the first empty line. */
const HEADERS_END = /\r?\n\r?\n/;

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
 * Splits `gh api -i` output into the status, the headers and the body.
 * @param text - The output.
 * @returns The status (0 if there is no status line), headers with lowercase names and body.
 */
function splitHead(text: string): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  const match = STATUS_LINE.exec(text);
  if (match === null) return { status: 0, headers: {}, body: text };
  const end = HEADERS_END.exec(text);
  const head = end === null ? text : text.slice(0, end.index);
  const body = end === null ? "" : text.slice(end.index + end[0].length);
  const headers: Record<string, string> = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0)
      headers[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim();
  }
  return { status: Number(match[1]), headers, body };
}

/**
 * Calls `gh api` over REST. The body goes through stdin as JSON, so types do not depend on
 * gh's `-f`/`-F` flags.
 * @param method - HTTP method.
 * @param path - Path without a leading `/`, with its query (`repos/o/r/issues/1`).
 * @param body - Body, if the call has one.
 * @param opts - `include` also reads the headers.
 * @returns The result; never throws.
 * @example await ghApi("GET", "repos/acme/widgets")
 */
export function ghApi(
  method: Method,
  path: string,
  body?: unknown,
  opts: GhOptions = {},
): Promise<GhResult> {
  const args = ["api", "--method", method, path];
  if (opts.include) args.push("-i");
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
      const split = opts.include ? splitHead(out) : null;
      const data = parseJson(split === null ? out : split.body);
      const extra = split === null ? {} : { headers: split.headers };
      if (code === 0)
        return resolve({
          ok: true,
          status: split?.status || 200,
          data,
          stderr: err,
          ...extra,
        });
      const match = HTTP_STATUS.exec(err);
      resolve({
        ok: false,
        status: match ? Number(match[1]) : (split?.status ?? 0),
        data,
        stderr: err,
        ...extra,
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

/** The `after` cursor of the `rel="next"` link in a `Link` header. */
const NEXT_AFTER = /<[^>]*[?&]after=([^&>]+)[^>]*>;\s*rel="next"/;

/**
 * Reads a REST list paginated by cursor (Projects v2 items), 100 at a time, up to
 * `maxPages` pages. It takes the `after` cursor of `Link rel="next"` and repeats on the same
 * `path`, without following the link's URL, which points to another route
 * (`user/<id>/…`). Same error rules as `ghGetAll`.
 * @param path - Path of the list, with or without a query.
 * @param maxPages - Page ceiling.
 * @param what - What is being read, for the error.
 * @returns The items and whether the list was cut short.
 * @throws GitHubError if the first page fails.
 * @example await ghGetCursor("users/acme/projectsV2/3/items", 20, "the items")
 */
export async function ghGetCursor(
  path: string,
  maxPages: number,
  what: string,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = [];
  const first = `${path}${path.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}`;
  let url = first;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await ghApi("GET", url, undefined, { include: true });
    if (!res.ok || !Array.isArray(res.data)) {
      if (page === 1) throw failure(res, `could not read ${what}`);
      return { items, truncated: true };
    }
    items.push(...res.data);
    const next = NEXT_AFTER.exec(res.headers?.link ?? "");
    if (next === null) return { items, truncated: false };
    url = `${first}&after=${encodeURIComponent(decodeURIComponent(next[1] as string))}`;
  }
  return { items, truncated: true };
}
