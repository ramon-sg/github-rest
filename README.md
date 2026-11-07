# github-rest

What an issue workflow uses from GitHub (read, list, create and edit issues and their work,
create the branch, manage labels, find, open and edit PRs, read their checks, reviews,
comments and commits, reply), **over REST only** with `gh api`. It works where GraphQL is
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
github-rest pr checks <n> | pr reviews <n> | pr comments <n> | pr commits <n>
github-rest pr reply <n> <comment-id> (--body <text> | --body-file <file>)
github-rest project fields <owner> <n>
github-rest project items <owner> <n> [--field <name>…]
github-rest project add <owner> <n> --issue <n> [-R owner/repo]
github-rest project set <owner> <n> --issue <n> --field <name> --value <v> [-R owner/repo]
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
- **`pr find`** and **`pr view`** print `{number, state, isDraft, headRefOid, body, url}`, the
  fields of `gh pr view --json`.
- **`pr comments`** groups the diff comments by thread: `[{id, user, path, line, outdated,
  body, url, createdAt, replies}]`. Whether a thread is resolved only exists in GraphQL.
- **`pr reply`** accepts the id of any comment of the thread.
- **`pr commits`** prints `[{sha, parents, message, author: {name, email, date}, committedAt}]`,
  oldest first (GitHub lists up to 250).
- **`project …`** works on a regular machine only: in Claude's cloud it exits 3 (see
  [GitHub Projects](#github-projects-local-and-in-claudes-cloud)). It takes the project's
  owner (a user or an organization, found out on its own) and its number, the one in
  `github.com/users/<owner>/projects/<n>`.
  - **`project fields`** prints `[{id, name, type, options?}]`; `options` only for single select.
  - **`project items`** prints `[{id, type, repo, number, state, title, values}]`, with
    `values` by field name: numbers stay numbers, single select gives the option, lists
    (labels, assignees) the names joined with commas. Without `--field` it reads every field.
    A field name also matches ignoring case, if only one does.
  - **`project add`** prints `{id, added}`; `added` is false if the issue was already there.
  - **`project set`** finds the issue's item (adding the issue if it is not in the project) and
    prints `{item, added, field, value}`. It writes number (with a dot for decimals), text,
    date (`YYYY-MM-DD`) and single select (the option's name) fields; `--value ""` clears it.
    A value the field cannot take exits 2 before writing.
  - **Archived items** are not in `project items` (REST leaves them out and ignores
    `q=is:archived`), and GitHub refuses to write them. `add` and `set` on an archived issue
    exit 1 and say so. Right after an add, the list takes a few seconds to show the new item.

There is no `pr merge` nor `pr ready`. Merging stays with `gh pr merge`, which Claude Code's
auto mode reviews before it runs, and taking a PR out of draft and resolving threads only exist
in GraphQL, which Claude's cloud blocks.

JSON on stdout, warnings on stderr. Exits 0 on success, 1 if GitHub failed (or `gh` is not in
the PATH), 2 on bad usage and 3 when a `project` command runs in Claude's cloud. The repo comes, like in gh, from `-R`, then the `GH_REPO`
variable (`owner/repo` or `host/owner/repo`), then the directory's `origin`. The origin can
be a GitHub URL (https, `git@`, `ssh://`) or the local git proxy of Claude's cloud
(`http://local_proxy@127.0.0.1:<port>/git/owner/repo`).

## GitHub Projects, local and in Claude's cloud

Projects v2 goes a different way on each side:

| Where | How | Why |
|---|---|---|
| A regular machine | `github-rest project …` (REST through your `gh` session) | |
| Claude's cloud | The GitHub connector's tools: `projects_list`, `projects_get`, `projects_write` | Its GitHub proxy answers 403 to every Projects path |

Claude Code sets `CLAUDE_CODE_REMOTE=true` in cloud sessions (claude.ai/code and scheduled
tasks). With it, `github-rest project …` exits 3 before calling GitHub and prints the
connector guide. Without it, a 403 that says the proxy blocked the call
("sessions are bound to their configured repositories") also exits 3. Any other 403 (a token
without the `project` scope) exits 1 with GitHub's message. The library throws
`ProjectsBlockedError` in the same cases, and `inClaudeCloud()` tells where it runs.

REST is the way; the connector is only a stopgap for the cloud, until its proxy lets Projects
through ([#9](https://github.com/ramon-sg/github-rest/issues/9)). If you never use Claude's
cloud, you don't need the connector.

For a skill or an agent that has to work on both sides:

1. Run `github-rest project …`, also when the connector's tools are there.
2. Only if it exits 3 (Claude's cloud), use the connector's tools. If they are not there, stop
   the Projects part and tell the user the GitHub connector is missing, with the link to its
   guide.

To write in a project when something happens on GitHub (an issue is closed, a PR is merged),
use a GitHub Action instead of the agent: issues are usually closed by a merge or by a person,
when no agent session is running, and Actions run outside the cloud's proxy. The Action needs
a secret with a classic token with `project` (`GITHUB_TOKEN` can't reach Projects v2) and can
run `npx @ramon-sg/github-rest project set …` with `GH_TOKEN` set to it. More in
[agent-cloud-kit#5](https://github.com/ramon-sg/agent-cloud-kit/issues/5).

The connector is set up once per claude.ai account: **[docs/projects-connector.md](docs/projects-connector.md)**
(`https://github.com/ramon-sg/github-rest/blob/main/docs/projects-connector.md`, the link to
give a user or an agent when the connector is missing).

Why the cloud can't use REST: its GitHub proxy only lets through paths under
`repos/{owner}/{repo}/…` and answers 403 to the rest ("sessions are bound to their configured
repositories"). Projects v2 only has paths under `users/` and `orgs/` (and GraphQL, also
blocked), and a `GH_TOKEN` of your own gets the same 403.

`scripts/probe-projects.sh` calls the Projects REST endpoints on a test project (it needs a
number field named `Probe`) and puts every value back. This is what it measured:

```bash
scripts/probe-projects.sh <owner> <project-n> <repo> <issue-n> <pr-n> [<archived-item-id>]
```

| Endpoint | Local (2026-11-07) | Claude's cloud (2026-11-07) |
|---|---|---|
| `GET …/projectsV2/{n}/fields` | 200 | 403 |
| `GET …/projectsV2/{n}/items?fields[]=…` (cursor in `Link`) | 200 | 403 |
| `GET …/projectsV2/{n}/items/{id}` | 200 | 403 |
| `POST …/projectsV2/{n}/items` | 201; 422 if the issue is already there | not tried (reads failed) |
| `PATCH …/projectsV2/{n}/items/{id}` | 200; 422 if the item is archived | not tried |
| `DELETE …/projectsV2/{n}/items/{id}` | 204 | not tried |
| `GET repos/{r}/pulls/{n}/commits` | 200 | 200 |

`…` is `users/{owner}` or `orgs/{owner}`.

## Library

```ts
import { readWork, resolveRepo, startBranch } from "@ramon-sg/github-rest";
const repo = resolveRepo(undefined); // like -R: the flag, then GH_REPO, then origin
const { output, warnings } = await readWork("acme/widgets", [42]);
```

When the working directory (or `opts.cwd`) is a checkout of that repo, `readWork` also reads
the local state and, to do so, runs `git fetch --prune` and `git worktree prune` there.

`prIssues(branch, body)` says which issues a PR names, with the same rules as
`issue-work --json` (below): the number of its branch and the `#n` of its closing or
`Part of` / `Parte de` phrases, without repeats and in ascending order. The per-issue checks
`issueBranchRe(n)`, `closesIssue(body, n)` and `refsIssue(body, n)` are exported too, and
always agree with `prIssues`.

```ts
import { prIssues } from "@ramon-sg/github-rest";
prIssues("feat/19-split-hours", "Closes #19\nCloses #6"); // [6, 19]
```

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
