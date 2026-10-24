/**
 * @file The `pr` commands of the CLI. There is no `merge` nor `ready`: merging stays with
 * `gh`, where guardrails such as `claude-perimeter` watch it, and taking a PR out of draft
 * only exists in GraphQL.
 */
import {
  bodyOf,
  emit,
  type Flags,
  issueNumber,
  repoOf,
  UsageError,
} from "./args.js";
import { GitHubError } from "./gh.js";
import { createPr, findPr, getPr, prView, updatePr } from "./pulls.js";
import {
  prChecks,
  prComments,
  prReviews,
  replyToComment,
} from "./reviews.js";

/** Warning when a list hit its page ceiling. */
const TRUNCATED = "the list was cut short: GitHub has more than was read.";

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
 * `pr view <n>`.
 * @param flags - Options.
 * @param n - Number.
 * @throws GitHubError if it does not exist.
 */
async function prViewCommand(flags: Flags, n: number): Promise<void> {
  const repo = repoOf(flags);
  const pr = await getPr(repo, n);
  if (pr === null)
    throw new GitHubError(`PR #${n} does not exist in ${repo}.`, 404);
  emit(prView(pr));
}

/**
 * `pr edit <n> [--body | --body-file] [--reopen]`.
 * @param flags - Options.
 * @param n - Number.
 * @throws UsageError or GitHubError.
 */
async function prEdit(flags: Flags, n: number): Promise<void> {
  const body = bodyOf(flags);
  if (body === undefined && !flags.reopen)
    throw new UsageError("pr edit needs --body, --body-file or --reopen.");
  await updatePr(repoOf(flags), n, {
    ...(body === undefined ? {} : { body }),
    ...(flags.reopen ? { state: "open" as const } : {}),
  });
}

/**
 * `pr reply <n> <comment-id> (--body | --body-file)`.
 * @param flags - Options.
 * @param n - PR number.
 * @param commentId - The comment, as text.
 * @throws UsageError or GitHubError.
 */
async function prReply(
  flags: Flags,
  n: number,
  commentId: string | undefined,
): Promise<void> {
  const id = issueNumber(commentId);
  const body = bodyOf(flags);
  if (body === undefined)
    throw new UsageError("pr reply needs --body or --body-file.");
  emit(await replyToComment(repoOf(flags), n, id, body));
}

/**
 * The `pr` subcommands that read a list: checks, reviews and comments.
 * @param flags - Options.
 * @param sub - Subcommand.
 * @param n - PR number.
 * @returns True if it handled the subcommand.
 * @throws GitHubError.
 */
async function prLists(
  flags: Flags,
  sub: string,
  n: number,
): Promise<boolean> {
  if (sub === "checks") {
    const { truncated, ...checks } = await prChecks(repoOf(flags), n);
    emit(checks, truncated ? [TRUNCATED] : []);
    return true;
  }
  if (sub === "reviews") {
    const { reviews, truncated } = await prReviews(repoOf(flags), n);
    emit(reviews, truncated ? [TRUNCATED] : []);
    return true;
  }
  if (sub === "comments") {
    const { threads, truncated } = await prComments(repoOf(flags), n);
    emit(threads, truncated ? [TRUNCATED] : []);
    return true;
  }
  return false;
}

/** Subcommands of `pr` that take only the PR number; extra arguments are a usage error. */
const LISTS = new Set(["checks", "reviews", "comments"]);

/**
 * `pr find|view|create|edit|checks|reviews|comments|reply`.
 * @param flags - Options.
 * @param args - Positionals after `pr`.
 * @throws UsageError or GitHubError.
 */
export async function prCommand(flags: Flags, args: string[]): Promise<void> {
  const [sub, target, ...extra] = args;
  if (sub === "create") return prCreate(flags);
  if (sub === "find" && target !== undefined) {
    const pr = await findPr(repoOf(flags), target);
    return emit(pr === null ? null : prView(pr));
  }
  if (sub === "reply" && extra.length === 1)
    return prReply(flags, issueNumber(target), extra[0]);
  // WHY: view and edit ignored extra arguments before 0.2.0; they still do.
  if (sub === "view") return prViewCommand(flags, issueNumber(target));
  if (sub === "edit") return prEdit(flags, issueNumber(target));
  if (sub !== undefined && LISTS.has(sub) && extra.length === 0)
    if (await prLists(flags, sub, issueNumber(target))) return;
  throw new UsageError(
    "pr usage: find <branch> | view <n> | create … | edit <n> … | checks <n> | reviews <n> | comments <n> | reply <n> <comment-id> …",
  );
}
