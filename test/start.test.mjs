// Tests of `github-rest issue-work start`: the fake gh creates the branch in the bare origin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { issue, REPO_BODY, sandbox } from "./helpers.mjs";

const LINK = "POST graphql CreateLinkedBranch";

function base(s) {
  const oid = s.git(s.origin, "rev-parse", "main");
  s.route("GET repos/acme/widgets", REPO_BODY);
  s.route("GET repos/acme/widgets/issues/42", issue(42));
  s.route("GET repos/acme/widgets/git/ref/heads/main", {
    object: { sha: oid },
  });
  s.route(LINK, {
    data: { createLinkedBranch: { linkedBranch: { ref: { name: "x" } } } },
  });
  s.route("POST repos/acme/widgets/git/refs", { ref: "x" }, 201);
  return oid;
}

test("creates the linked branch and fetches it, with no local branch", () => {
  const s = sandbox();
  const oid = base(s);
  const r = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-new",
  ]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), {
    repo: "acme/widgets",
    branch: "feat/42-new",
    base: "main",
    oid,
    linked: true,
  });
  const link = s.calls().find((c) => c.path === "graphql");
  assert.deepEqual(
    [link.body.variables.issueId, link.body.variables.repositoryId],
    ["I_42", "R_1"],
  );
  assert.equal(s.git(s.origin, "rev-parse", "feat/42-new"), oid);
  assert.equal(
    s.git(s.repo, "rev-parse", "refs/remotes/origin/feat/42-new"),
    oid,
  );
  assert.equal(s.git(s.repo, "branch", "--list", "feat/42-new"), "");
});

test("--base: uses it, and exits with 1 if it does not exist", () => {
  const s = sandbox();
  const oid = base(s);
  s.route("GET repos/acme/widgets/git/ref/heads/develop", {
    object: { sha: oid },
  });
  assert.equal(
    s
      .run(s.repo, [
        "issue-work",
        "start",
        "42",
        "--branch",
        "feat/42-o",
        "--base",
        "develop",
      ])
      .json().base,
    "develop",
  );
  const r = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-x",
    "--base",
    "nope",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.err, /base branch nope does not exist/);
});

test("the branch already exists: exits with 1 without trying to create it", () => {
  const s = sandbox();
  base(s);
  s.route("GET repos/acme/widgets/git/ref/heads/feat/42-new", {
    ref: "refs/heads/feat/42-new",
  });
  const r = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-new",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.err, /already exists in acme\/widgets/);
  assert.ok(!s.calls().some((c) => c.method === "POST"));
});

test("branch names are encoded per segment in the ref path", () => {
  const s = sandbox();
  base(s);
  s.route("GET repos/acme/widgets/git/ref/heads/feat/42-a%23b", {
    object: { sha: "x" },
  });
  const r = s.run(s.repo, ["issue-work", "start", "42", "--branch", "feat/42-a#b"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /branch feat\/42-a#b already exists/);
  assert.equal(s.calls().at(-1).path, "repos/acme/widgets/git/ref/heads/feat/42-a%23b");
});

test("an issue that does not exist: exits with 1", () => {
  const s = sandbox();
  base(s);
  s.route("GET repos/acme/widgets/issues/42", { message: "Not Found" }, 404);
  const r = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-y",
  ]);
  assert.equal(r.status, 1);
  assert.match(r.err, /issue #42 does not exist/);
});

test("without GraphQL: creates it over REST unlinked; if that fails too, exits with 1", () => {
  const s = sandbox();
  const oid = base(s);
  s.route(
    LINK,
    { message: "GitHub GraphQL is not available from Claude Code sessions" },
    403,
  );
  const r = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-unlinked",
  ]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().linked, false);
  assert.match(r.err, /created it unlinked/);
  assert.equal(s.git(s.origin, "rev-parse", "feat/42-unlinked"), oid);
  s.route(
    "POST repos/acme/widgets/git/refs",
    { message: "Resource not accessible" },
    403,
  );
  const none = s.run(s.repo, [
    "issue-work",
    "start",
    "42",
    "--branch",
    "feat/42-none",
  ]);
  assert.equal(none.status, 1);
  assert.match(none.err, /could not create branch feat\/42-none/);
});

test("outside a checkout of the repo: does not fetch", () => {
  const s = sandbox();
  base(s);
  assert.equal(
    s.run(s.outside, [
      "issue-work",
      "start",
      "42",
      "--branch",
      "feat/42-far",
      "-R",
      "acme/widgets",
    ]).status,
    0,
  );
  assert.throws(() =>
    s.git(
      s.repo,
      "rev-parse",
      "--verify",
      "-q",
      "refs/remotes/origin/feat/42-far",
    ),
  );
});

test("usage", () => {
  const s = sandbox();
  for (const args of [
    ["42"],
    ["42", "--branch", "feat/42..bad"],
    ["x", "--branch", "feat/42-z"],
  ]) {
    assert.equal(
      s.run(s.repo, ["issue-work", "start", ...args]).status,
      2,
      args.join(" "),
    );
  }
});
