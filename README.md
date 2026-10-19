# github-rest

What an issue workflow uses from GitHub (read an issue and its work, create its branch, find,
open and edit PRs, assign), **over REST only** with `gh api`. It works where GraphQL is
blocked: in Claude's cloud, the GitHub proxy answers 403 to all GraphQL (`gh issue`,
`gh pr`) and lets `gh api` through with REST, with no token of its own.

Needs `gh` and `git`. Node 20 or later, or Bun.

## Installation

```bash
npm i -D @ramon-sg/github-rest   # or bun add -d
```

## CLI

```bash
github-rest issue-work <n> [<n>…] [-R owner/repo] --json
github-rest issue-work start <n> --branch <branch> [--base <branch>] [-R owner/repo]
github-rest issue view <n> | issue assign <n> <login…|@me>
github-rest pr find <branch> | pr view <n>
github-rest pr create --head <branch> --base <branch> --title <title> (--body <text> | --body-file <file>) [--draft]
github-rest pr edit <n> [--body <text> | --body-file <file>] [--reopen]
```

JSON on stdout, warnings on stderr. Exits 0 on success, 1 if GitHub failed and 2 on bad
usage. The repo comes from `-R` or the directory's `origin`.

## Library

```ts
import { readWork, startBranch } from "@ramon-sg/github-rest";
const { output, warnings } = await readWork("acme/widgets", [42]);
```

## `issue-work --json`

```text
{repo, defaultBranch, [offline: true], [graphql: false], issues: [
  {number, state, assignees: [login],
   work: {prs: [{number, state: OPEN|CLOSED|MERGED, draft, branch, head, fork, closes}],
          branches: [{name, remote, linked, merged}]},
   mentions: [{number, state, branch}],
   local: {branches: [name], worktrees: [{path, branch}]}}
  | {number, error: "NOT_FOUND"}]}
```

- A branch belongs to the issue if it has `<n>-` at the start or after a `/`.
- A PR is work of the issue if it comes from one of those branches or its body says
  `Closes`, `Fixes`, `Resolves`, `Part of` or `Parte de #n`. `closes` is true if it closes the
  issue with those words.
- `linked` comes from GraphQL; if GitHub does not answer it, the output has `graphql: false`.
- Offline: `{repo, defaultBranch: null, offline: true, issues: [{number, local}]}`.

## Development

```bash
npm install && npm test
```

A new version is published with a `v*` tag (GitHub Actions, npm Trusted Publisher).
