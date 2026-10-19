// Tests of `github-rest issue …` and `github-rest pr …` against the fake gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { headQuery, issue, pull, sandbox } from "./helpers.mjs";

test("issue view: the fields of gh --json", () => {
  const s = sandbox();
  s.route(
    "GET repos/acme/widgets/issues/42",
    issue(42, { labels: ["docs", { name: "bug" }] }),
  );
  const r = s.run(s.repo, ["issue", "view", "42"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), {
    number: 42,
    title: "Issue 42",
    state: "OPEN",
    body: "",
    url: "https://github.com/acme/widgets/issues/42",
    labels: [{ name: "docs" }, { name: "bug" }],
    assignees: [{ login: "ana" }],
  });
});

test("issue view: a missing issue and a PR number exit with 1", () => {
  const s = sandbox();
  assert.equal(s.run(s.repo, ["issue", "view", "42"]).status, 1);
  s.route("GET repos/acme/widgets/issues/7", issue(7, { pull_request: {} }));
  const r = s.run(s.repo, ["issue", "view", "7"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /issue #7 does not exist/);
});

test("issue assign: @me is the gh account", () => {
  const s = sandbox();
  s.route("GET user", { login: "ramon" });
  s.route(
    "POST repos/acme/widgets/issues/42/assignees",
    issue(42, { assignees: [{ login: "Ramon" }, { login: "ana" }] }),
    201,
  );
  const r = s.run(s.repo, ["issue", "assign", "42", "@me", "ana"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.calls().at(-1), {
    method: "POST",
    path: "repos/acme/widgets/issues/42/assignees",
    body: { assignees: ["ramon", "ana"] },
  });
});

test("issue assign: someone GitHub ignored exits with 1", () => {
  const s = sandbox();
  s.route("POST repos/acme/widgets/issues/42/assignees", issue(42), 201);
  const r = s.run(s.repo, ["issue", "assign", "42", "ana", "bob"]);
  assert.equal(r.status, 1);
  assert.match(
    r.err,
    /could not assign bob to issue #42 \(GitHub ignored it\)/,
  );
});

test("without gh in PATH: exits with 1 and says so", () => {
  const s = sandbox();
  const PATH = s.pathWithoutGh();
  for (const args of [
    ["issue", "view", "42"],
    ["issue-work", "42", "--json"],
  ]) {
    const r = s.run(s.repo, args, { PATH });
    assert.equal(r.status, 1, `${args.join(" ")}: ${r.out}${r.err}`);
    assert.match(r.err, /gh not found in PATH/);
    assert.equal(r.out, "");
  }
});

test("issue assign: if it can't tell who you are, exits with 1", () => {
  const s = sandbox();
  s.route(
    "GET user",
    { message: "GitHub access to /user is not enabled for this session" },
    403,
  );
  assert.equal(s.run(s.repo, ["issue", "assign", "42", "@me"]).status, 1);
});

test("pr find: the newest PR of the branch, or null", () => {
  const s = sandbox();
  s.route(headQuery("feat/42-a"), [
    pull(8, "OPEN", "feat/42-a", "Closes #42"),
    pull(5, "MERGED", "feat/42-a"),
  ]);
  const r = s.run(s.repo, ["pr", "find", "feat/42-a"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), {
    number: 8,
    state: "OPEN",
    headRefOid: "oid8",
    body: "Closes #42",
    url: "https://github.com/acme/widgets/pull/8",
  });
  s.route(headQuery("feat/42-b"), []);
  assert.equal(s.run(s.repo, ["pr", "find", "feat/42-b"]).out.trim(), "null");
});

test("pr view: MERGED comes from merged_at", () => {
  const s = sandbox();
  s.route(
    "GET repos/acme/widgets/pulls/5",
    pull(5, "MERGED", "feat/42-a", "hello"),
  );
  assert.equal(s.run(s.repo, ["pr", "view", "5"]).json().state, "MERGED");
  assert.equal(s.run(s.repo, ["pr", "view", "6"]).status, 1);
});

test("pr create: draft via POST and the URL on stdout", () => {
  const s = sandbox();
  s.route("POST repos/acme/widgets/pulls", pull(9, "OPEN", "feat/42-a"), 201);
  const r = s.run(s.repo, [
    "pr",
    "create",
    "--draft",
    "--base",
    "main",
    "--head",
    "feat/42-a",
    "--title",
    "T",
    "--body",
    "Closes #42",
  ]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.trim(), "https://github.com/acme/widgets/pull/9");
  assert.deepEqual(s.calls().at(-1).body, {
    head: "feat/42-a",
    base: "main",
    title: "T",
    body: "Closes #42",
    draft: true,
  });
});

test("pr edit: body from a file, and reopen", () => {
  const s = sandbox();
  s.route("PATCH repos/acme/widgets/pulls/9", pull(9, "OPEN", "feat/42-a"));
  const file = `${s.tmp}/body.md`;
  writeFileSync(file, "Part of #42");
  assert.equal(
    s.run(s.repo, ["pr", "edit", "9", "--body-file", file, "--reopen"]).status,
    0,
  );
  assert.deepEqual(s.calls().at(-1).body, {
    body: "Part of #42",
    state: "open",
  });
});

test("usage: exits with 2", () => {
  const s = sandbox();
  for (const args of [
    ["pr", "create", "--head", "x"],
    ["pr", "edit", "9"],
    ["issue", "view", "4x"],
    ["nope"],
    ["pr", "find"],
    ["issue", "view", "1", "--nope"],
  ]) {
    assert.equal(s.run(s.repo, args).status, 2, args.join(" "));
  }
  const help = s.run(s.repo, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.out, /github-rest pr create/);
});

test("repo: -R wins; outside a checkout and without -R exits with 1", () => {
  const s = sandbox();
  s.route("GET repos/other/thing/issues/1", issue(1));
  assert.equal(
    s.run(s.outside, ["issue", "view", "1", "-R", "other/thing"]).status,
    0,
  );
  const r = s.run(s.outside, ["issue", "view", "1"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /can't tell which repo/);
  assert.equal(
    s.run(s.outside, ["issue", "view", "1", "-R", "noslash"]).status,
    2,
  );
});

test("pr create: a title and body that start with a dash arrive unchanged", () => {
  const s = sandbox();
  s.route("POST repos/acme/widgets/pulls", pull(9, "OPEN", "feat/42-a"), 201);
  const r = s.run(s.repo, [
    "pr",
    "create",
    "--head",
    "feat/42-a",
    "--base",
    "main",
    "--title",
    "-x",
    "--body",
    "- [ ] item",
  ]);
  assert.equal(r.status, 0, r.err);
  const sent = s.calls().at(-1).body;
  assert.equal(sent.title, "-x");
  assert.equal(sent.body, "- [ ] item");
  const dashes = s.run(s.repo, [
    "pr", "create", "--head", "h", "--base", "main", "--title", "T", "--body", "--",
  ]);
  assert.equal(dashes.status, 0, dashes.err);
  assert.equal(s.calls().at(-1).body.body, "--");
});

test("a string option with no value at the end exits with 2", () => {
  const s = sandbox();
  assert.equal(s.run(s.repo, ["pr", "find", "x", "--title"]).status, 2);
  assert.equal(s.run(s.repo, ["pr", "find", "x", "-R"]).status, 2);
});
