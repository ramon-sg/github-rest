/**
 * @file Naming rules of the issue workflow: which branch belongs to an issue and which PR
 * body closes it or names it as work. They are the same as the gh issue-work extension's.
 * Each rule is written once, with the issue number as a slot: filled with `n` it answers
 * "does this PR name issue n?", and filled with a capture it answers "which issues does it
 * name?" (`prIssues`), so the two questions cannot disagree.
 */

/** Words GitHub uses to close an issue from a PR. */
const CLOSING_WORDS = "close[sd]?|fix(?:e[sd])?|resolve[sd]?";

/** Phrases that mark a PR as part of the work without closing the issue (`parte de` is the Spanish form). */
const PART_WORDS = "part of|parte de";

/** Closing words and work phrases together. */
const WORK_WORDS = `${CLOSING_WORDS}|${PART_WORDS}`;

/** Capture for an issue number in the slot: no leading zero, so `#012` is not 12. */
const NUMBER = "([1-9][0-9]*)";

/**
 * Pattern for a branch of the issue: `<n>-` at the start or after a `/`.
 * @param num - The number, or `NUMBER` to capture it.
 * @returns The pattern.
 */
const branchSource = (num: string) => `(?:^|/)${num}-`;

/**
 * Pattern for a phrase followed by `#n`, with an optional colon (`Closes: #n`), not
 * accepting `#n0`.
 * @param words - Alternatives for the phrase.
 * @param num - The number, or `NUMBER` to capture it.
 * @returns The pattern, to be used case-insensitive.
 */
const phraseSource = (words: string, num: string) =>
  `\\b(?:${words}):?\\s*#${num}(?![0-9])`;

/**
 * Expression for a phrase followed by `#n`.
 * @param words - Alternatives for the phrase.
 * @param n - Issue number.
 * @returns The expression, case-insensitive.
 */
const phraseRe = (words: string, n: number) =>
  new RegExp(phraseSource(words, String(n)), "i");

/**
 * Expression for a branch of the issue: `<n>-` at the start or after a `/`.
 * @param n - Issue number.
 * @returns The expression.
 * @example issueBranchRe(42).test("feat/42-x") // true
 */
export const issueBranchRe = (n: number) => new RegExp(branchSource(String(n)));

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
  phraseRe(WORK_WORDS, n).test(body ?? "");

/** Every branch number, with the same pattern as `issueBranchRe`. */
const BRANCH_ALL = new RegExp(branchSource(NUMBER), "g");

/** Every `#n` of a closing or work phrase, with the same pattern as `refsIssue`. */
const PHRASE_ALL = new RegExp(phraseSource(WORK_WORDS, NUMBER), "gi");

/**
 * Issues a PR names as its work: the number of its branch (`<n>-` at the start or after a
 * `/`) and the `#n` its body closes or marks with `Part of` / `Parte de`. Same rules as
 * `issueBranchRe` and `refsIssue`.
 * @param branch - PR head branch.
 * @param body - PR body (may be empty).
 * @returns The issue numbers, without repeats and in ascending order.
 * @example prIssues("feat/19-x", "Closes #19\nCloses #6") // [6, 19]
 */
export const prIssues = (branch: string, body: string | null | undefined): number[] => {
  const found = new Set<number>();
  for (const m of branch.matchAll(BRANCH_ALL)) found.add(Number(m[1]));
  for (const m of (body ?? "").matchAll(PHRASE_ALL)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
};
