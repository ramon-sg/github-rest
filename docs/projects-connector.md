# GitHub Projects from Claude's cloud: the GitHub connector

In Claude's cloud (claude.ai/code sessions and scheduled tasks) GitHub Projects v2 can't be
reached with `gh`, so `github-rest project …` only works on a regular machine. To read and
write a project's fields in the cloud, use GitHub's MCP server as a claude.ai **connector**.
This guide sets it up.

The connector is a stopgap for the cloud only: everywhere else use `github-rest project …`,
even if the connector is set up. Once the cloud's proxy lets Projects through, it goes away
([#9](https://github.com/ramon-sg/github-rest/issues/9)). If you never use Claude's cloud,
you don't need it.

It is set up **once per claude.ai account**, not per repo: every session and scheduled task
of that account gets it.

## For agents: is the connector there?

Run `github-rest project …` first. Use the connector only if it exits 3: that means Claude's
cloud (`CLAUDE_CODE_REMOTE=true`), where it stops without calling GitHub. On a regular
machine, don't use the connector even if its tools are there.

Look for tools whose names end in `projects_list`, `projects_get` and `projects_write`. In a
cloud session they are named `mcp__GitHub__projects_list`, `mcp__GitHub__projects_get` and
`mcp__GitHub__projects_write`; the middle part is the name the user gave the connector.

- **They are there:** use them. See [Using the tools](#using-the-tools).
- **They are not there:** you can't create the connector yourself: it lives in the user's
  claude.ai account and holds their token. Stop the Projects part of the task, tell the user
  that the GitHub connector is missing, and give them the link to this page:
  `https://github.com/ramon-sg/github-rest/blob/main/docs/projects-connector.md`
- **Don't** try `github-rest project`, `gh project`, `gh api users/…/projectsV2/…`,
  `gh api orgs/…` or GraphQL from the cloud: they all get a 403 (see [Why](#why-not-gh)).
- **A write asks for permission every time:** the connector's tool permissions are on
  "Needs approval". Tell the user to do [step 3](#3-let-the-tools-run-without-asking).

## Setup (for the person)

### 1. Create a GitHub token

1. Open https://github.com/settings/tokens/new (a classic token).
2. **Note:** `Claude MCP projects`. **Expiration:** 90 days is a good default.
3. **Scopes:** `project` and `repo` (`repo` is needed to add issues of private repos). An
   organization's project may also need `read:org`.
4. **Generate token** and copy it (`ghp_…`). GitHub shows it once.

### 2. Add the connector in claude.ai

claude.ai → **Settings** → **Connectors** → **Add custom connector**:

| Field | Value |
|---|---|
| Name | `GitHub` |
| URL | `https://api.githubcopilot.com/mcp/x/projects` (only the Projects tools) |
| Authentication | **No sign-in** (the dialog warns that the server needs sign-in: the header below is the sign-in) |
| Request header | `Authorization` = `Bearer ghp_…` (the word Bearer, a space and the token) |

Leave the OAuth client fields empty: GitHub's server does not register clients on its own,
and the token makes them unnecessary.

### 3. Let the tools run without asking

Open the connector (claude.ai → **Settings** → **Connectors** → **GitHub**). Under **Tool
permissions**, set both **Read-only tools** and **Write/delete tools** to always allow (✓).

Without this, every call stops with "Projects Write requests permission", and a scheduled
task waits for someone to answer. A `permissions.allow` rule in a repo's
`.claude/settings.json` does **not** skip that prompt; only this setting does.

### 4. Check it

In a new claude.ai/code session, with the connector on:

> Use only the GitHub connector to list the fields of project <n> of <owner>.

It should answer with the fields (Title, Status, …) without asking for permission.

To stop it, delete the token at github.com/settings/tokens or disconnect the connector.

## Using the tools

| To | Tool and method | Notes |
|---|---|---|
| List a project's fields | `projects_list`, `list_project_fields` | |
| List items with values | `projects_list`, `list_project_items` with `field_names: ["Estimate", "Status"]` | Pages of 50; follow the pages to the end (a project of 178 items took 4 pages) |
| Read one item | `projects_get`, `get_project_item` with `item_id` and `field_names` | Also reads archived items |
| Add an issue | `projects_write`, `add_project_item` with `item_owner`, `item_repo`, `issue_number`, `item_type: "issue"` | Adding an issue that is already there returns the same item, without error |
| Write a field | `projects_write`, `update_project_item` with `item_owner`, `item_repo`, `issue_number` | No need to know the item id. An empty value clears the field |
| Remove an item | `projects_write`, `delete_project_item` with `item_id` | The issue stays open in its repo |

Archived items are not listed and can't be written: GitHub answers "This item is archived and
cannot be updated". Unarchive it first.

All of the above was tested from a cloud session on 2026-11-07.

## Why not `gh`

Claude's cloud sends all GitHub traffic through a proxy that:

- only serves `repos/{owner}/{repo}/…` paths of the repos attached to the session, and answers
  403 "sessions are bound to their configured repositories" to everything else, including
  `users/{owner}/projectsV2/…` and `orgs/{org}/projectsV2/…`;
- answers 403 to all GraphQL, which `gh project` uses;
- does the same with a `GH_TOKEN` of your own.

Connector traffic goes through Anthropic's servers instead, so the proxy does not apply.
Outside the cloud, `github-rest project …` (REST) works as usual.

`scripts/probe-projects.sh` measures the REST endpoints; its results are in the
[README](../README.md#github-projects-local-and-in-claudes-cloud).
