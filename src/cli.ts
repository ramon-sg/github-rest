#!/usr/bin/env node
/**
 * @file `github-rest` CLI: what an issue workflow uses from GitHub, over REST only. JSON on
 * stdout, warnings on stderr; exits 0 on success, 1 if GitHub failed and 2 on bad usage.
 */
import { spawnSync } from "node:child_process";
import {
  emit,
  type Flags,
  issueNumber,
  parse,
  repoOf,
  UsageError,
} from "./args.js";
import { issueCommand, labelCommand } from "./issue-commands.js";
import { prCommand } from "./pr-commands.js";
import { startBranch } from "./start.js";
import { readWork } from "./work.js";

/** Usage text for every command. */
const USAGE = `Usage:
  github-rest issue-work <n> [<n>...] [-R owner/repo] --json
  github-rest issue-work start <n> --branch <branch> [--base <branch>] [-R owner/repo]
  github-rest issue view <n>
  github-rest issue assign <n> <login|@me...>
  github-rest issue create --title <title> (--body <text> | --body-file <file>) [--label <l>...] [--assignee <login|@me>...]
  github-rest issue edit <n> [--title <title>] [--body <text> | --body-file <file>] [--add-label <l>...] [--remove-label <l>...] [--close | --reopen]
  github-rest issue list [--state open|closed|all] [--label <l>...] [--missing-heading <text>] [--limit <n>]
  github-rest issue comments <n>
  github-rest issue comment <n> (--body <text> | --body-file <file>)
  github-rest label list
  github-rest label create <name> [--color <hex>] [--description <text>] [--force]
  github-rest pr find <branch>
  github-rest pr view <n>
  github-rest pr create --head <branch> --base <branch> --title <title> (--body <text> | --body-file <file>) [--draft]
  github-rest pr edit <n> [--body <text> | --body-file <file>] [--reopen]
  github-rest pr checks <n> | pr reviews <n> | pr comments <n>
  github-rest pr reply <n> <comment-id> (--body <text> | --body-file <file>)

Every command takes -R owner/repo. Labels and assignees also take commas (--label a,b).`;

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
  else if (group === "label") await labelCommand(flags, rest);
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
