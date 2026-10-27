// Test helpers: a test repo whose origin says github.com/acme/widgets (insteadOf points it to a
// local bare repo), the fake gh first in the PATH, the compiled CLI and REST fixtures.
import {
  chmodSync,
  mkdirSync,
  symlinkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");
const GIT_ID = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

export const REPO_BODY = {
  full_name: "acme/widgets",
  default_branch: "main",
  node_id: "R_1",
};

export function pull(
  n,
  state,
  branch,
  body = "",
  { draft = false, fork = false } = {},
) {
  return {
    number: n,
    state: state === "OPEN" ? "open" : "closed",
    merged_at: state === "MERGED" ? "2026-01-01T00:00:00Z" : null,
    draft,
    body,
    html_url: `https://github.com/acme/widgets/pull/${n}`,
    head: {
      ref: branch,
      sha: `oid${n}`,
      repo: { full_name: fork ? "someone/widgets" : "acme/widgets" },
    },
    base: { repo: { full_name: "acme/widgets" } },
  };
}

export function issue(n, extra = {}) {
  return {
    number: n,
    title: `Issue ${n}`,
    state: "open",
    body: "",
    html_url: `https://github.com/acme/widgets/issues/${n}`,
    node_id: `I_${n}`,
    labels: [{ name: "bug" }],
    assignees: [{ login: "ana" }],
    ...extra,
  };
}

export function crossRef(n, repo = "acme/widgets") {
  return {
    event: "cross-referenced",
    source: {
      issue: {
        number: n,
        repository_url: `https://api.github.com/repos/${repo}`,
        pull_request: {},
      },
    },
  };
}

export const headQuery = (branch) =>
  `GET repos/acme/widgets/pulls?head=${encodeURIComponent(`acme:${branch}`)}&state=all&per_page=20`;

export function sandbox() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "github-rest-")));
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\nexec node "${join(HERE, "fake-gh.mjs")}" "$@"\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const origin = join(tmp, "origin.git");
  const repo = join(tmp, "repo");
  const outside = join(tmp, "outside");
  mkdirSync(outside);
  const git = (cwd, ...a) =>
    execFileSync("git", a, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...GIT_ID },
    }).trim();
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  // The first commit is made before adding the origin: cloning an empty bare repo warns.
  git(tmp, "init", "-q", "-b", "main", repo);
  git(repo, "commit", "-q", "--allow-empty", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");
  git(
    repo,
    "config",
    `url.${origin}.insteadOf`,
    "https://github.com/acme/widgets.git",
  );
  git(
    repo,
    "remote",
    "set-url",
    "origin",
    "https://github.com/acme/widgets.git",
  );
  const routes = {};
  const log = join(tmp, "calls.jsonl");
  const routesFile = join(tmp, "routes.json");
  return {
    tmp,
    repo,
    origin,
    outside,
    git,
    route(key, body, status = 200) {
      routes[key] = { status, body };
    },
    page(path, items, page = 1) {
      routes[
        `GET ${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`
      ] = { status: 200, body: items };
    },
    calls() {
      return readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    // A PATH with only node and git, to run the CLI without gh.
    pathWithoutGh() {
      const only = join(tmp, "no-gh");
      mkdirSync(only, { recursive: true });
      symlinkSync(process.execPath, join(only, "node"));
      const gitPath = execFileSync("sh", ["-c", "command -v git"], {
        encoding: "utf8",
      }).trim();
      symlinkSync(gitPath, join(only, "git"));
      return only;
    },
    run(cwd, args, env = {}) {
      writeFileSync(routesFile, JSON.stringify(routes));
      writeFileSync(log, "");
      const base = { ...process.env };
      // GH_REPO from the outer shell would change which repo every test uses.
      delete base.GH_REPO;
      const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: "utf8",
        env: {
          ...base,
          ...GIT_ID,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_GH_ROUTES: routesFile,
          FAKE_GH_LOG: log,
          FAKE_GH_ORIGIN: origin,
          ...env,
        },
      });
      const graphql = this.calls().filter((call) => call.path === "graphql");
      assert.deepEqual(graphql, [], "github-rest must only call REST endpoints");
      return {
        status: r.status,
        out: r.stdout,
        err: r.stderr,
        json: () => JSON.parse(r.stdout),
      };
    },
  };
}
