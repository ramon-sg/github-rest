/**
 * @file Arguments of the CLI: options, positionals, numbers, the repo, the body and the
 * output. Every command module uses these, so they live apart from the entry point.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { GitHubError } from "./gh.js";
import { InvalidRepoEnvError, resolveRepo } from "./repo.js";

/** Usage error: exits 2 and prints the usage text. */
export class UsageError extends Error {}

/** Options any command accepts; each command validates its own. */
const OPTIONS = {
  repo: { type: "string", short: "R" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  branch: { type: "string" },
  base: { type: "string" },
  head: { type: "string" },
  title: { type: "string" },
  body: { type: "string" },
  "body-file": { type: "string" },
  draft: { type: "boolean" },
  reopen: { type: "boolean" },
  close: { type: "boolean" },
  label: { type: "string", multiple: true },
  "add-label": { type: "string", multiple: true },
  "remove-label": { type: "string", multiple: true },
  assignee: { type: "string", multiple: true },
  state: { type: "string" },
  limit: { type: "string" },
  "missing-heading": { type: "string" },
  color: { type: "string" },
  description: { type: "string" },
  force: { type: "boolean" },
} as const;

/** Parsed options. */
export interface Flags {
  repo?: string;
  json?: boolean;
  help?: boolean;
  branch?: string;
  base?: string;
  head?: string;
  title?: string;
  body?: string;
  "body-file"?: string;
  draft?: boolean;
  reopen?: boolean;
  close?: boolean;
  label?: string[];
  "add-label"?: string[];
  "remove-label"?: string[];
  assignee?: string[];
  state?: string;
  limit?: string;
  "missing-heading"?: string;
  color?: string;
  description?: string;
  force?: boolean;
}

/** An issue or PR number: digits only (`042` is 42). */
const NUMBER = /^\d+$/;

/** The `owner/repo` value of `-R`. */
const REPO_FLAG = /^[^/\s]+\/[^/\s]+$/;

/**
 * Joins each string option with its value into a single `--name=value` token, so that
 * `parseArgs` does not mistake a value that starts with `-` (`--body "- item"`) for another
 * option. Boolean options are left as they are and a string option with no value at the end
 * is still a usage error. Derived from `OPTIONS`, with no duplicated list.
 * @param argv - Arguments without `node` or the script.
 * @returns The arguments with string options joined to their value.
 * @example joinOptionValues(["--title", "-x"]) // ["--title=-x"]
 */
export function joinOptionValues(argv: string[]): string[] {
  const byToken = new Map<string, string>();
  for (const [name, spec] of Object.entries(OPTIONS)) {
    if (spec.type !== "string") continue;
    byToken.set(`--${name}`, name);
    if ("short" in spec) byToken.set(`-${spec.short}`, name);
  }
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token === "--") {
      out.push(...argv.slice(i));
      break;
    }
    const name = byToken.get(token);
    if (name === undefined || i + 1 >= argv.length) out.push(token);
    else out.push(`--${name}=${argv[++i] as string}`);
  }
  return out;
}

/**
 * Parses the arguments; `-R` can go anywhere.
 * @param argv - Arguments without `node` or the script.
 * @returns Options and positionals.
 * @throws UsageError if an option is unknown or has no value.
 */
export function parse(argv: string[]): { flags: Flags; args: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: joinOptionValues(argv),
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    return { flags: values as Flags, args: positionals };
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Issue, PR or comment number from an argument.
 * @param text - The argument.
 * @returns The number.
 * @throws UsageError if it is not a number.
 */
export function issueNumber(text: string | undefined): number {
  if (text === undefined || !NUMBER.test(text))
    throw new UsageError(`invalid number: ${text ?? "(missing)"}`);
  return Number(text);
}

/**
 * The values of a repeatable option, each one also split on commas like gh does
 * (`--label a,b --label c` is `a`, `b`, `c`). Empty pieces are dropped.
 * @param values - What `parseArgs` gave, or undefined.
 * @returns The values.
 * @example listOf(["a,b", "c"]) // ["a", "b", "c"]
 */
export function listOf(values: string[] | undefined): string[] {
  return (values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/**
 * Repo of the command: `-R`, `GH_REPO` or the directory's origin.
 * @param flags - Options.
 * @returns `owner/repo`.
 * @throws UsageError if `-R` or `GH_REPO` is malformed; GitHubError if there is no repo.
 */
export function repoOf(flags: Flags): string {
  if (flags.repo !== undefined && !REPO_FLAG.test(flags.repo))
    throw new UsageError(`-R expects owner/repo: ${flags.repo}`);
  let repo: string | null;
  try {
    repo = resolveRepo(flags.repo);
  } catch (error) {
    if (error instanceof InvalidRepoEnvError)
      throw new UsageError(error.message);
    throw error;
  }
  if (repo === null)
    throw new GitHubError(
      "can't tell which repo this is: run inside a checkout whose origin is on GitHub, pass -R owner/repo or set GH_REPO.",
      0,
    );
  return repo;
}

/**
 * Prints a result as JSON and the warnings on stderr.
 * @param value - What to print.
 * @param warnings - Warnings.
 */
export function emit(value: unknown, warnings: string[] = []): void {
  for (const warning of warnings)
    process.stderr.write(`github-rest: ${warning}\n`);
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Body from `--body` or `--body-file`.
 * @param flags - Options.
 * @returns The body, or undefined if none was given.
 */
export function bodyOf(flags: Flags): string | undefined {
  if (flags.body !== undefined) return flags.body;
  return flags["body-file"] === undefined
    ? undefined
    : readFileSync(flags["body-file"], "utf8");
}
