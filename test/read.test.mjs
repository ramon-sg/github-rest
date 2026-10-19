// Tests of `github-rest issue-work <n> --json`: gh issue-work's contract over REST.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crossRef,
  headQuery,
  issue,
  pull,
  REPO_BODY,
  sandbox,
} from "./helpers.mjs";

const LINKED = "POST graphql LinkedBranches";

function base(s, n = 42) {
  s.route("GET repos/acme/widgets", REPO_BODY);
  s.route(`GET repos/acme/widgets/issues/${n}`, issue(n));
  s.page("repos/acme/widgets/branches", [{ name: "main" }]);
  s.page(`repos/acme/widgets/issues/${n}/timeline`, []);
}

test("work, mentions and branches", () => {
  const s = sandbox();
  base(s);
  const prs = [
    pull(7, "OPEN", "feat/42-open", "Closes #42"),
    pull(5, "MERGED", "feat/42-old", "Issue: #42"),
    pull(11, "OPEN", "chore/ci", "Parte de #42 (PR 2 de 3)."),
    pull(12, "OPEN", "feat/43-other", "Part of #420. Ver #42."),
    pull(13, "OPEN", "42-fork", "", { fork: true }),
    pull(15, "CLOSED", "feat/42-dropped", "", { draft: true }),
  ];
  for (const pr of prs)
    s.route(`GET repos/acme/widgets/pulls/${pr.number}`, pr);
  s.page("repos/acme/widgets/branches", [
    { name: "main" },
    { name: "feat/42-open" },
    { name: "feat/420-other" },
  ]);
  s.page("repos/acme/widgets/issues/42/timeline", [
    ...[5, 7, 11, 12, 13, 15].map((n) => crossRef(n)),
    crossRef(99, "other/repo"),
    { event: "labeled" },
  ]);
  s.route(headQuery("feat/42-open"), [prs[0]]);
  s.route(LINKED, {
    data: {
      repository: {
        i42: { linkedBranches: { nodes: [{ ref: { name: "42-linked" } }] } },
      },
    },
  });
  const r = s.run(s.repo, ["issue-work", "42", "--json"]);
  assert.equal(r.status, 0, r.err);
  const out = r.json();
  const i = out.issues[0];
  const pr = (n) => i.work.prs.find((p) => p.number === n);
  const names = (f) => i.work.branches.filter(f).map((b) => b.name);
  assert.deepEqual(
    [out.repo, out.defaultBranch, out.offline, out.graphql],
    ["acme/widgets", "main", undefined, undefined],
  );
  assert.deepEqual([i.state, i.assignees], ["OPEN", ["ana"]]);
  assert.deepEqual(
    i.work.prs.map((p) => p.number),
    [5, 7, 11, 13, 15],
  );
  assert.equal(pr(7).closes, true);
  assert.equal(pr(5).closes, false);
  assert.deepEqual(
    [pr(15).draft, pr(15).branch, pr(15).head],
    [true, "feat/42-dropped", "oid15"],
  );
  assert.equal(pr(13).fork, true);
  assert.deepEqual(i.mentions, [
    { number: 12, state: "OPEN", branch: "feat/43-other" },
  ]);
  assert.deepEqual(
    names(() => true),
    ["42-linked", "chore/ci", "feat/42-dropped", "feat/42-old", "feat/42-open"],
  );
  assert.deepEqual(
    names((b) => b.remote),
    ["feat/42-open"],
  );
  assert.deepEqual(
    names((b) => b.linked),
    ["42-linked"],
  );
  assert.deepEqual(
    names((b) => b.merged),
    ["feat/42-old"],
  );
  assert.ok(
    !s.calls().some((c) => c.path === "repos/acme/widgets/pulls/99"),
    "does not request the PR of another repo",
  );
});

test("without GraphQL: graphql false and nothing linked", () => {
  const s = sandbox();
  base(s);
  s.route(
    LINKED,
    { message: "GitHub GraphQL is not available from Claude Code sessions" },
    403,
  );
  const r = s.run(s.repo, ["issue-work", "42", "--json"]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().graphql, false);
});

test("a merged branch reused by an open PR is not merged", () => {
  const s = sandbox();
  base(s);
  s.page("repos/acme/widgets/branches", [{ name: "feat/42-a" }]);
  s.route(headQuery("feat/42-a"), [
    pull(6, "OPEN", "feat/42-a"),
    pull(5, "MERGED", "feat/42-a"),
  ]);
  assert.equal(
    s.run(s.repo, ["issue-work", "42", "--json"]).json().issues[0].work
      .branches[0].merged,
    false,
  );
});

test("what is on this machine, with fetch --prune", () => {
  const s = sandbox();
  base(s);
  s.git(s.repo, "branch", "feat/42-mine");
  s.git(s.repo, "branch", "feat/420-x");
  s.git(s.repo, "worktree", "add", "-q", `${s.tmp}/wt42`, "-b", "42-local");
  s.git(s.origin, "branch", "feat/42-gone", "main");
  s.git(s.repo, "fetch", "-q", "origin");
  s.git(s.origin, "branch", "-D", "feat/42-gone");
  const i = s.run(s.repo, ["issue-work", "42", "--json"]).json().issues[0];
  assert.deepEqual(i.local.branches, ["42-local", "feat/42-mine"]);
  assert.deepEqual(i.local.worktrees, [
    { path: `${s.tmp}/wt42`, branch: "42-local" },
  ]);
  assert.deepEqual(
    i.work.branches.filter((b) => !b.remote).map((b) => b.name),
    ["42-local", "feat/42-mine"],
  );
  assert.throws(() =>
    s.git(
      s.repo,
      "rev-parse",
      "--verify",
      "-q",
      "refs/remotes/origin/feat/42-gone",
    ),
  );
});

test("offline: only the local state", () => {
  const s = sandbox();
  s.git(s.repo, "branch", "feat/42-mine");
  const r = s.run(s.repo, ["issue-work", "42", "--json"], {
    FAKE_GH_OFFLINE: "1",
  });
  assert.equal(r.status, 0);
  const out = r.json();
  assert.deepEqual(
    [out.offline, out.defaultBranch, out.issues[0].work],
    [true, null, undefined],
  );
  assert.deepEqual(out.issues[0].local.branches, ["feat/42-mine"]);
  assert.match(r.err, /could not reach GitHub/);
});

test("an issue that does not exist or is a PR: NOT_FOUND", () => {
  const s = sandbox();
  base(s);
  s.route("GET repos/acme/widgets/issues/7", issue(7, { pull_request: {} }));
  const out = s.run(s.repo, ["issue-work", "41", "7", "--json"]).json();
  assert.deepEqual(out.issues, [
    { number: 41, error: "NOT_FOUND" },
    { number: 7, error: "NOT_FOUND" },
  ]);
});

test("a repo that does not exist: exits with 1", () => {
  const s = sandbox();
  const r = s.run(s.repo, ["issue-work", "42", "--json"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /repo acme\/widgets not found/);
});

test("truncated lists: warns and carries on", () => {
  const s = sandbox();
  base(s);
  const many = Array.from({ length: 100 }, (_, k) => ({ name: `x-${k}` }));
  for (let p = 1; p <= 10; p += 1)
    s.page(
      "repos/acme/widgets/branches",
      p === 1 ? [{ name: "feat/42-a" }, ...many.slice(1)] : many,
      p,
    );
  s.page(
    "repos/acme/widgets/issues/42/timeline",
    Array.from({ length: 100 }, () => ({ event: "labeled" })),
  );
  s.route(
    headQuery("feat/42-a"),
    Array.from({ length: 20 }, (_, k) => pull(100 + k, "CLOSED", "feat/42-a")),
  );
  const r = s.run(s.repo, ["issue-work", "42", "--json"]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().issues[0].work.prs.length, 20);
  assert.match(r.err, /more than 1000 branches/);
  assert.match(r.err, /#42: could not fetch all the mentions/);
  assert.match(r.err, /branch feat\/42-a has more than 20 PRs/);
});

test("several issues: requested order, no duplicates, a single GraphQL query", () => {
  const s = sandbox();
  base(s, 42);
  base(s, 43);
  s.page("repos/acme/widgets/branches", [
    { name: "feat/42-a" },
    { name: "feat/43-b" },
  ]);
  s.route(headQuery("feat/42-a"), [pull(7, "OPEN", "feat/42-a")]);
  s.route(headQuery("feat/43-b"), [pull(8, "OPEN", "feat/43-b")]);
  const out = s.run(s.repo, ["issue-work", "43", "42", "43", "--json"]).json();
  assert.deepEqual(
    out.issues.map((i) => i.number),
    [43, 42],
  );
  assert.deepEqual(
    out.issues.map((i) => i.work.prs[0].number),
    [8, 7],
  );
  const queries = s.calls().filter((c) => c.path === "graphql");
  assert.equal(queries.length, 1);
  assert.match(queries[0].body.query, /i42: issue\(number: 42\)/);
});

test("-R: another repo, without the local state", () => {
  const s = sandbox();
  s.route("GET repos/other/thing", { ...REPO_BODY, full_name: "other/thing" });
  s.route("GET repos/other/thing/issues/42", issue(42));
  s.page("repos/other/thing/branches", []);
  s.page("repos/other/thing/issues/42/timeline", []);
  assert.equal(
    s.run(s.outside, ["issue-work", "42", "-R", "other/thing", "--json"])
      .status,
    0,
  );
  s.git(s.repo, "branch", "feat/42-mine");
  const r = s.run(s.repo, ["issue-work", "42", "--json", "-R", "other/thing"]);
  assert.deepEqual(r.json().issues[0].local, { branches: [], worktrees: [] });
  assert.equal(s.run(s.repo, ["issue-work", "42", "--json", "-R"]).status, 2);
});

test("a renamed repo: later calls use its current full_name", () => {
  const s = sandbox();
  s.route("GET repos/old/name", REPO_BODY);
  s.route("GET repos/acme/widgets/issues/42", issue(42));
  s.page("repos/acme/widgets/branches", [{ name: "main" }]);
  s.page("repos/acme/widgets/issues/42/timeline", [crossRef(7)]);
  s.route("GET repos/acme/widgets/pulls/7", pull(7, "OPEN", "chore/x", "Ver #42"));
  const r = s.run(s.outside, ["issue-work", "42", "-R", "old/name", "--json"]);
  assert.equal(r.status, 0, r.err);
  const out = r.json();
  assert.equal(out.repo, "acme/widgets");
  assert.deepEqual(out.issues[0].mentions, [
    { number: 7, state: "OPEN", branch: "chore/x" },
  ]);
});

test("usage", () => {
  const s = sandbox();
  base(s);
  assert.equal(s.run(s.repo, ["issue-work", "42"]).status, 2);
  assert.equal(s.run(s.repo, ["issue-work", "--json"]).status, 2);
  assert.equal(s.run(s.repo, ["issue-work", "4x2", "--json"]).status, 2);
  const help = s.run(s.repo, ["issue-work", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.out, /github-rest issue-work <n>/);
  assert.equal(s.run(s.outside, ["issue-work", "42", "--json"]).status, 1);
  s.run(s.repo, ["issue-work", "042", "--json"]);
  assert.ok(s.calls().some((c) => c.path === "repos/acme/widgets/issues/42"));
});
