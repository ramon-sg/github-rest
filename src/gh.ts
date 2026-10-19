/**
 * @file GitHub transport: every call goes through `gh api`, which in Claude's cloud is the
 * only thing the proxy authenticates and on a regular machine uses the `gh` session. GraphQL
 * only through `graphql()`, which is never required: in the cloud the proxy answers it 403.
 */
import { spawn } from "node:child_process";

/** HTTP method of a call. */
export type Method = "GET" | "POST" | "PATCH";

/** Result of `gh api`: `status` is the HTTP code, or 0 if there was no response (offline). */
export interface GhResult {
  ok: boolean;
  status: number;
  data: unknown;
  stderr: string;
}

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
    child.on("error", (error) =>
      resolve({ ok: false, status: 0, data: null, stderr: error.message }),
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
 * @returns The items and whether the list was cut short.
 * @throws GitHubError if the first page fails.
 * @example await ghGetAll("repos/acme/widgets/branches", 10, "the branches")
 */
export async function ghGetAll(
  path: string,
  maxPages: number,
  what: string,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await ghApi(
      "GET",
      `${path}${sep}per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!res.ok || !Array.isArray(res.data)) {
      if (page === 1) throw failure(res, `could not read ${what}`);
      return { items, truncated: true };
    }
    items.push(...res.data);
    if (res.data.length < PAGE_SIZE) return { items, truncated: false };
  }
  return { items, truncated: true };
}

/**
 * Optional GraphQL: the response's `data`, or null if GitHub does not answer. With partial
 * errors (an issue that does not exist) it returns what came back.
 * @param query - The query or mutation, with an operation name.
 * @param variables - Its variables.
 * @returns The data, or null.
 * @example await graphql("query Q { viewer { login } }", {})
 */
export async function graphql(
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await ghApi("POST", "graphql", { query, variables });
  const data = (res.data as { data?: unknown } | null)?.data;
  return data !== null && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
}
