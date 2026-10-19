/**
 * @file Naming rules of the issue workflow: which branch belongs to an issue and which PR
 * body closes it or names it as work. They are the same as the gh issue-work extension's.
 */

/** Words GitHub uses to close an issue from a PR. */
const CLOSING_WORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";

/** Phrases that mark a PR as part of the work without closing the issue (`parte de` is the Spanish form). */
const PART_WORDS = "part of|parte de";

/**
 * Expression for a phrase followed by `#n`, with an optional colon (`Closes: #n`), not
 * accepting `#n0`.
 * @param words - Alternatives for the phrase.
 * @param n - Issue number.
 * @returns The expression, case-insensitive.
 */
const phraseRe = (words: string, n: number) =>
  new RegExp(`\\b(?:${words}):?\\s*#${n}(?![0-9])`, "i");

/**
 * Expression for a branch of the issue: `<n>-` at the start or after a `/`.
 * @param n - Issue number.
 * @returns The expression.
 * @example issueBranchRe(42).test("feat/42-x") // true
 */
export const issueBranchRe = (n: number) => new RegExp(`(^|/)${n}-`);

/**
 * Whether a PR body closes the issue with a GitHub closing word.
 * @param body - PR body (may be empty).
 * @param n - Issue number.
 * @returns Whether it closes it.
 * @example closesIssue("Fixes #42", 42) // true
 */
export const closesIssue = (body: string | null | undefined, n: number) =>
  phraseRe(CLOSING_WORDS, n).test(body ?? "");

/**
 * Whether a PR body marks it as work of the issue: it closes it, or says `Part of` or
 * `Parte de #n`.
 * @param body - PR body.
 * @param n - Issue number.
 * @returns Whether it is work of the issue.
 * @example refsIssue("Parte de #42", 42) // true
 */
export const refsIssue = (body: string | null | undefined, n: number) =>
  closesIssue(body, n) || phraseRe(PART_WORDS, n).test(body ?? "");
