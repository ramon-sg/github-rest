/**
 * @file The `issue` and `label` commands of the CLI.
 */
import {
  bodyOf,
  emit,
  type Flags,
  issueNumber,
  listOf,
  repoOf,
  UsageError,
} from "./args.js";
import { GitHubError } from "./gh.js";
import {
  addComment,
  assign,
  createIssue,
  editIssue,
  type IssueChange,
  type IssueFilter,
  issueComments,
  listIssues,
  viewIssue,
} from "./issues.js";
import { createLabel, listLabels } from "./labels.js";

/** States `issue list --state` accepts. */
const LIST_STATES = new Set(["open", "closed", "all"]);

/** A positive whole number, for `--limit`. */
const POSITIVE = /^[1-9]\d*$/;

/** A label color: six hex digits, with or without `#`. */
const COLOR = /^#?[0-9a-fA-F]{6}$/;

/** Warning when a list hit its page ceiling. */
const TRUNCATED = "the list was cut short: GitHub has more than was read.";

/**
 * `issue create --title <t> (--body <b> | --body-file <f>) [--label <l>] [--assignee <a>]`.
 * @param flags - Options.
 * @throws UsageError or GitHubError.
 */
async function issueCreate(flags: Flags): Promise<void> {
  const body = bodyOf(flags);
  if (flags.title === undefined || body === undefined)
    throw new UsageError(
      "issue create needs --title and --body or --body-file.",
    );
  const { warnings, ...created } = await createIssue(repoOf(flags), {
    title: flags.title,
    body,
    labels: listOf(flags.label),
    assignees: listOf(flags.assignee),
  });
  emit(created, warnings);
}

/**
 * The changes `issue edit` asks for.
 * @param flags - Options.
 * @returns The change.
 * @throws UsageError if it asks for nothing or to close and reopen at once.
 */
function issueChange(flags: Flags): IssueChange {
  if (flags.close && flags.reopen)
    throw new UsageError("use --close or --reopen, not both.");
  const body = bodyOf(flags);
  const addLabels = listOf(flags["add-label"]);
  const removeLabels = listOf(flags["remove-label"]);
  const change: IssueChange = {
    ...(flags.title === undefined ? {} : { title: flags.title }),
    ...(body === undefined ? {} : { body }),
    ...(flags.close ? { state: "closed" as const } : {}),
    ...(flags.reopen ? { state: "open" as const } : {}),
    ...(addLabels.length === 0 ? {} : { addLabels }),
    ...(removeLabels.length === 0 ? {} : { removeLabels }),
  };
  if (Object.keys(change).length === 0)
    throw new UsageError(
      "issue edit needs --title, --body, --body-file, --add-label, --remove-label, --close or --reopen.",
    );
  return change;
}

/**
 * The filter of `issue list`.
 * @param flags - Options.
 * @returns The filter.
 * @throws UsageError if `--state` or `--limit` is invalid.
 */
function issueFilter(flags: Flags): IssueFilter {
  if (flags.state !== undefined && !LIST_STATES.has(flags.state))
    throw new UsageError(`--state expects open, closed or all: ${flags.state}`);
  if (flags.limit !== undefined && !POSITIVE.test(flags.limit))
    throw new UsageError(`--limit expects a positive number: ${flags.limit}`);
  const labels = listOf(flags.label);
  return {
    ...(flags.state === undefined
      ? {}
      : { state: flags.state as "open" | "closed" | "all" }),
    ...(labels.length === 0 ? {} : { labels }),
    ...(flags["missing-heading"] === undefined
      ? {}
      : { missingHeading: flags["missing-heading"] }),
    ...(flags.limit === undefined ? {} : { limit: Number(flags.limit) }),
  };
}

/**
 * `issue view <n>`.
 * @param flags - Options.
 * @param n - Number.
 * @throws GitHubError if it does not exist.
 */
async function issueView(flags: Flags, n: number): Promise<void> {
  const repo = repoOf(flags);
  const found = await viewIssue(repo, n);
  if (found === null)
    throw new GitHubError(`issue #${n} does not exist in ${repo}.`, 404);
  emit(found);
}

/**
 * The `issue` subcommands that take a number: view, assign, edit, comments and comment.
 * @param flags - Options.
 * @param sub - Subcommand.
 * @param rest - Positionals after the subcommand.
 * @returns True if it handled the subcommand.
 * @throws UsageError or GitHubError.
 */
async function issueByNumber(
  flags: Flags,
  sub: string | undefined,
  rest: string[],
): Promise<boolean> {
  const [number, ...logins] = rest;
  if (sub === "view" && logins.length === 0) {
    await issueView(flags, issueNumber(number));
    return true;
  }
  if (sub === "assign" && logins.length > 0) {
    await assign(repoOf(flags), issueNumber(number), logins);
    return true;
  }
  if (logins.length > 0) return false;
  if (sub === "edit") {
    const n = issueNumber(number);
    await editIssue(repoOf(flags), n, issueChange(flags));
    return true;
  }
  if (sub === "comments") {
    const n = issueNumber(number);
    const { comments, truncated } = await issueComments(repoOf(flags), n);
    emit(comments, truncated ? [TRUNCATED] : []);
    return true;
  }
  if (sub === "comment") {
    const n = issueNumber(number);
    const body = bodyOf(flags);
    if (body === undefined)
      throw new UsageError("issue comment needs --body or --body-file.");
    emit(await addComment(repoOf(flags), n, body));
    return true;
  }
  return false;
}

/**
 * `issue view|assign|create|edit|list|comments|comment`.
 * @param flags - Options.
 * @param args - Positionals after `issue`.
 * @throws UsageError or GitHubError.
 */
export async function issueCommand(flags: Flags, args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  if (sub === "create" && rest.length === 0) return issueCreate(flags);
  if (sub === "list" && rest.length === 0) {
    const { issues, truncated } = await listIssues(
      repoOf(flags),
      issueFilter(flags),
    );
    return emit(issues, truncated ? [TRUNCATED] : []);
  }
  if (await issueByNumber(flags, sub, rest)) return;
  throw new UsageError(
    "issue usage: view <n> | assign <n> <login...> | create … | edit <n> … | list … | comments <n> | comment <n> …",
  );
}

/**
 * `label create <name> [--color <hex>] [--description <d>] [--force]`.
 * @param flags - Options.
 * @param name - The label.
 * @throws UsageError or GitHubError.
 */
async function labelCreate(flags: Flags, name: string): Promise<void> {
  if (flags.color !== undefined && !COLOR.test(flags.color))
    throw new UsageError(`--color expects six hex digits: ${flags.color}`);
  const { created } = await createLabel(repoOf(flags), {
    name,
    ...(flags.color === undefined
      ? {}
      : { color: flags.color.replace(/^#/, "").toLowerCase() }),
    ...(flags.description === undefined
      ? {}
      : { description: flags.description }),
    force: flags.force ?? false,
  });
  emit({ name, created });
}

/**
 * `label list` and `label create`.
 * @param flags - Options.
 * @param args - Positionals after `label`.
 * @throws UsageError or GitHubError.
 */
export async function labelCommand(flags: Flags, args: string[]): Promise<void> {
  const [sub, name, ...extra] = args;
  if (sub === "list" && name === undefined) {
    const { labels, truncated } = await listLabels(repoOf(flags));
    return emit(labels, truncated ? [TRUNCATED] : []);
  }
  if (sub === "create" && name !== undefined && extra.length === 0)
    return labelCreate(flags, name);
  throw new UsageError("label usage: list | create <name> [--color <hex>] [--description <d>] [--force]");
}
