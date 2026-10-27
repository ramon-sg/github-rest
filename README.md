# github-rest

What an issue workflow uses from GitHub (read, list, create and edit issues and their work,
create the branch, manage labels, find, open and edit PRs, read their checks, reviews and
comments, reply), **over REST only** with `gh api`. It works where GraphQL is
blocked: in Claude's cloud, the GitHub proxy answers 403 to all GraphQL (`gh issue`,
`gh pr`) and lets `gh api` through with REST, with no token of its own.

Needs `gh` and `git`, and Node 20 or later. With Bun, run the CLI with `bunx --bun github-rest`
or keep `node` on the PATH (the binary's shebang is `node`).

## Installation

```bash
npm i -D @ramon-sg/github-rest   # or bun add -d
```

## CLI

```bash
github-rest issue-work <n> [<n>…] [-R owner/repo] --json
github-rest issue-work start <n> --branch <branch> [--base <branch>] [-R owner/repo]
github-rest issue view <n> | issue assign <n> <login…|@me>
github-rest issue create --title <title> (--body <text> | --body-file <file>) [--label <l>…] [--assignee <login|@me>…]
github-rest issue edit <n> [--title <title>] [--body <text> | --body-file <file>] [--add-label <l>…] [--remove-label <l>…] [--close | --reopen]
github-rest issue list [--state open|closed|all] [--label <l>…] [--missing-heading <text>] [--limit <n>]
github-rest issue comments <n> | issue comment <n> (--body <text> | --body-file <file>)
github-rest label list | label create <name> [--color <hex>] [--description <text>] [--force]
github-rest pr find <branch> | pr view <n>
github-rest pr create --head <branch> --base <branch> --title <title> (--body <text> | --body-file <file>) [--draft]
github-rest pr edit <n> [--body <text> | --body-file <file>] [--reopen]
github-rest pr checks <n> | pr reviews <n> | pr comments <n>
github-rest pr reply <n> <comment-id> (--body <text> | --body-file <file>)
```

- **`issue-work start`** creates the branch with REST and prints `{repo, branch, base, oid}`.
  It does not link it in the issue's Development panel: that only exists in GraphQL.
- **Labels and assignees** repeat the flag or take commas (`--label bug,area:ui`).
- **`issue create`** prints `{number, url}`; `pr create` prints only the URL. GitHub creates
  a label that does not exist (gh fails instead) and drops, with a warning here, the labels
  and assignees the account cannot set.
- **`issue list`** leaves PRs out and returns up to 100 issues by default, with the fields of
  `issue view`. `--missing-heading` keeps the ones whose body does not contain that text
  (for example `**Rama sugerida`, which also matches `**Rama sugerida:**`). It reads at most 1000 items and warns if there were more.
- **`issue comments` and `issue comment`** also work with a PR number: they are the PR's
  conversation, not the comments on its diff.
- **`label create --force`** updates the color and description if the label exists, so a
  setup script can run twice.
- **`pr checks`** prints `{sha, checks: [{name, state, bucket, link, kind}]}` for the PR's
  head: the latest check runs and the commit statuses. `bucket` is `pass`, `fail`, `pending`,
  `skipping` or `cancel`, as in `gh pr checks`; it exits 0 whatever the checks say.
- **`pr comments`** groups the diff comments by thread: `[{id, user, path, line, outdated,
  body, url, createdAt, replies}]`. Whether a thread is resolved only exists in GraphQL.
- **`pr reply`** accepts the id of any comment of the thread.

There is no `pr merge` nor `pr ready`. Merging stays with `gh pr merge`, which Claude Code's
auto mode reviews before it runs, and taking a PR out of draft and resolving threads only exist
in GraphQL, which Claude's cloud blocks.

JSON on stdout, warnings on stderr. Exits 0 on success, 1 if GitHub failed (or `gh` is not in
the PATH) and 2 on bad usage. The repo comes, like in gh, from `-R`, then the `GH_REPO`
variable (`owner/repo` or `host/owner/repo`), then the directory's `origin`. The origin can
be a GitHub URL (https, `git@`, `ssh://`) or the local git proxy of Claude's cloud
(`http://local_proxy@127.0.0.1:<port>/git/owner/repo`).

## Library

```ts
import { readWork, resolveRepo, startBranch } from "@ramon-sg/github-rest";
const repo = resolveRepo(undefined); // like -R: the flag, then GH_REPO, then origin
const { output, warnings } = await readWork("acme/widgets", [42]);
```

When the working directory (or `opts.cwd`) is a checkout of that repo, `readWork` also reads
the local state and, to do so, runs `git fetch --prune` and `git worktree prune` there.

## `issue-work --json`

```text
{repo, defaultBranch, [offline: true], issues: [
  {number, state, assignees: [login],
   work: {prs: [{number, state: OPEN|CLOSED|MERGED, draft, branch, head, fork, closes}],
          branches: [{name, remote, merged}]},
   mentions: [{number, state, branch}],
   local: {branches: [name], worktrees: [{path, branch}]}}
  | {number, error: "NOT_FOUND"}]}
```

- A branch belongs to the issue if it has `<n>-` at the start or after a `/`.
- A PR is work of the issue if it comes from one of those branches or its body says
  `Closes`, `Fixes`, `Resolves`, `Part of` or `Parte de #n` (`Parte de` is the Spanish form
  of `Part of`), with or without a colon (`Closes: #n`). `closes` is true if it closes the
  issue with those words.
- Branches linked in the issue's Development panel are not read: they only exist in GraphQL.
- Offline: `{repo, defaultBranch: null, offline: true, issues: [{number, local}]}`.

## Development

```bash
npm install && npm test
```

A new version is published with a `v*` tag (GitHub Actions, npm Trusted Publisher).
