#!/usr/bin/env node
/**
 * @file `github-rest` CLI: what an issue workflow uses from GitHub, over REST only. JSON on
 * stdout, warnings on stderr; exits 0 on success, 1 if GitHub failed and 2 on bad usage.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { GitHubError } from "./gh.js";
import { assign, viewIssue } from "./issues.js";
import { createPr, findPr, getPr, prView, updatePr } from "./pulls.js";
import { resolveRepo } from "./repo.js";
import { startBranch } from "./start.js";
import { readWork } from "./work.js";

/** Usage text for every command. */
const USAGE = `Usage:
  github-rest issue-work <n> [<n>...] [-R owner/repo] --json
  github-rest issue-work start <n> --branch <branch> [--base <branch>] [-R owner/repo]
  github-rest issue view <n> [-R owner/repo]
  github-rest issue assign <n> <login...> [-R owner/repo]
  github-rest pr find <branch> [-R owner/repo]
  github-rest pr view <n> [-R owner/repo]
  github-rest pr create --head <branch> --base <branch> --title <title> (--body <text> | --body-file <file>) [--draft] [-R owner/repo]
  github-rest pr edit <n> [--body <text> | --body-file <file>] [--reopen] [-R owner/repo]`;

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
 * Issue or PR number from an argument.
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
 * Repo of the command: `-R` or the directory's origin.
 * @param flags - Options.
 * @returns `owner/repo`.
 * @throws UsageError if `-R` is not `owner/repo`; GitHubError if there is no repo.
 */
export function repoOf(flags: Flags): string {
  if (flags.repo !== undefined && !REPO_FLAG.test(flags.repo))
    throw new UsageError(`-R expects owner/repo: ${flags.repo}`);
  const repo = resolveRepo(flags.repo);
  if (repo === null)
    throw new GitHubError(
      "can't tell which repo this is: run inside a checkout whose origin is on GitHub, or pass -R owner/repo.",
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
function bodyOf(flags: Flags): string | undefined {
  if (flags.body !== undefined) return flags.body;
  return flags["body-file"] === undefined
    ? undefined
    : readFileSync(flags["body-file"], "utf8");
}

/**
 * `issue view` and `issue assign`.
 * @param flags - Options.
 * @param args - Positionals after `issue`.
 * @throws UsageError or GitHubError.
 */
async function issueCommand(flags: Flags, args: string[]): Promise<void> {
  const [sub, number, ...logins] = args;
  const n = issueNumber(number);
  if (sub === "view" && logins.length === 0) {
    const repo = repoOf(flags);
    const found = await viewIssue(repo, n);
    if (found === null)
      throw new GitHubError(`issue #${n} does not exist in ${repo}.`, 404);
    return emit(found);
  }
  if (sub === "assign" && logins.length > 0)
    return assign(repoOf(flags), n, logins);
  throw new UsageError("issue usage: view <n> | assign <n> <login...>");
}

/**
 * `pr create`: requires head, base, title and body; prints the URL.
 * @param flags - Options.
 * @throws UsageError or GitHubError.
 */
async function prCreate(flags: Flags): Promise<void> {
  const body = bodyOf(flags);
  const { head, base, title } = flags;
  if (
    head === undefined ||
    base === undefined ||
    title === undefined ||
    body === undefined
  ) {
    throw new UsageError(
      "pr create needs --head, --base, --title and --body or --body-file.",
    );
  }
  const created = await createPr(repoOf(flags), {
    head,
    base,
    title,
    body,
    draft: flags.draft ?? false,
  });
  process.stdout.write(`${created.url}\n`);
}

/**
 * `pr find`, `pr view`, `pr create` and `pr edit`.
 * @param flags - Options.
 * @param args - Positionals after `pr`.
 * @throws UsageError or GitHubError.
 */
async function prCommand(flags: Flags, args: string[]): Promise<void> {
  const [sub, target] = args;
  if (sub === "create") return prCreate(flags);
  if (sub === "find" && target !== undefined) {
    const pr = await findPr(repoOf(flags), target);
    return emit(pr === null ? null : prView(pr));
  }
  if (sub === "view") {
    const n = issueNumber(target);
    const repo = repoOf(flags);
    const pr = await getPr(repo, n);
    if (pr === null)
      throw new GitHubError(`PR #${n} does not exist in ${repo}.`, 404);
    return emit(prView(pr));
  }
  if (sub === "edit") {
    const n = issueNumber(target);
    const body = bodyOf(flags);
    if (body === undefined && !flags.reopen)
      throw new UsageError("pr edit needs --body, --body-file or --reopen.");
    return updatePr(repoOf(flags), n, {
      ...(body === undefined ? {} : { body }),
      ...(flags.reopen ? { state: "open" as const } : {}),
    });
  }
  throw new UsageError(
    "pr usage: find <branch> | view <n> | create … | edit <n> …",
  );
}

/**
 * `issue-work start <n> --branch <branch> [--base <branch>]`.
 * @param flags - Options.
 * @param args - Positionals after `start`.
 * @throws UsageError or GitHubError.
 */
async function startCommand(flags: Flags, args: string[]): Promise<void> {
  if (args.length !== 1 || flags.branch === undefined)
    throw new UsageError("start needs <n> and --branch <branch>.");
  const n = issueNumber(args[0]);
  if (
    spawnSync("git", ["check-ref-format", "--branch", flags.branch]).status !==
    0
  )
    throw new UsageError(`invalid branch: ${flags.branch}`);
  const { result, warnings } = await startBranch(
    repoOf(flags),
    n,
    flags.branch,
    flags.base === undefined ? {} : { base: flags.base },
  );
  emit(result, warnings);
}

/**
 * `issue-work <n>... --json`, or `issue-work start …`.
 * @param flags - Options.
 * @param args - Positionals after `issue-work`.
 * @throws UsageError or GitHubError.
 */
async function issueWorkCommand(flags: Flags, args: string[]): Promise<void> {
  if (args[0] === "start") return startCommand(flags, args.slice(1));
  if (args.length === 0) throw new UsageError("missing the issue number.");
  if (!flags.json)
    throw new UsageError("only JSON output is available for now: add --json.");
  const numbers = args.map(issueNumber);
  const { output, warnings } = await readWork(repoOf(flags), numbers);
  emit(output, warnings);
}

/**
 * Runs the CLI.
 * @param argv - Arguments without `node` or the script.
 * @returns The exit code.
 * @throws UsageError or GitHubError, which the entry point handles.
 */
export async function main(argv: string[]): Promise<number> {
  const { flags, args } = parse(argv);
  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const [group, ...rest] = args;
  if (group === "issue-work") await issueWorkCommand(flags, rest);
  else if (group === "issue") await issueCommand(flags, rest);
  else if (group === "pr") await prCommand(flags, rest);
  else
    throw new UsageError(
      group === undefined
        ? "missing the command."
        : `unknown command: ${group}`,
    );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`github-rest: ${error.message}\n${USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(
      `github-rest: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
