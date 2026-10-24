// Tests of `github-rest pr checks|reviews|comments|reply` against the fake gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pull, sandbox } from "./helpers.mjs";

const REPO = "repos/acme/widgets";

const run = (name, status, conclusion = null) => ({
  name,
  status,
  conclusion,
  html_url: `https://ci/${name}`,
});

const comment = (id, extra = {}) => ({
  id,
  user: { login: "cubic-dev-ai[bot]" },
  body: `c${id}`,
  html_url: `u${id}`,
  created_at: `2026-01-0${id}T00:00:00Z`,
  path: "src/a.ts",
  line: 10,
  original_line: 10,
  subject_type: "line",
  in_reply_to_id: null,
  ...extra,
});

test("pr checks: check runs and statuses of the head commit, with gh's buckets", () => {
  const s = sandbox();
  s.route(`GET ${REPO}/pulls/9`, pull(9, "OPEN", "feat/42-a"));
  s.route(`GET ${REPO}/commits/oid9/check-runs?per_page=100&page=1`, {
    total_count: 7,
    check_runs: [
      run("test", "completed", "success"),
      run("lint", "completed", "failure"),
      run("e2e", "in_progress"),
      run("docs", "completed", "skipped"),
      run("deploy", "completed", "cancelled"),
      run("label", "completed", "neutral"),
      run("odd", "completed", "stale"),
    ],
  });
  s.route(`GET ${REPO}/commits/oid9/status?per_page=100&page=1`, {
    state: "failure",
    statuses: [
      { context: "ci/circleci", state: "error", target_url: "https://circle/1" },
      { context: "cubic", state: "pending", target_url: null },
    ],
  });

  const r = s.run(s.repo, ["pr", "checks", "9"]);

  assert.equal(r.status, 0, r.err);
  const { sha, checks } = r.json();
  assert.equal(sha, "oid9");
  assert.deepEqual(
    checks.map(({ name, state, bucket, kind }) => [name, state, bucket, kind]),
    [
      ["test", "SUCCESS", "pass", "check"],
      ["lint", "FAILURE", "fail", "check"],
      ["e2e", "IN_PROGRESS", "pending", "check"],
      ["docs", "SKIPPED", "skipping", "check"],
      ["deploy", "CANCELLED", "cancel", "check"],
      ["label", "NEUTRAL", "skipping", "check"],
      ["odd", "STALE", "pending", "check"],
      ["ci/circleci", "ERROR", "fail", "status"],
      ["cubic", "PENDING", "pending", "status"],
    ],
  );
  assert.equal(checks[7].link, "https://circle/1");
});

test("pr checks: a PR that does not exist exits with 1 without reading checks", () => {
  const s = sandbox();

  const r = s.run(s.repo, ["pr", "checks", "9"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /PR #9 does not exist/);
  assert.equal(s.calls().length, 1);
});

test("pr reviews: who reviewed, the state and the commit", () => {
  const s = sandbox();
  s.route(`GET ${REPO}/pulls/9/reviews?per_page=100&page=1`, [
    { id: 1, user: { login: "ana" }, state: "CHANGES_REQUESTED", body: "no", submitted_at: "2026-01-01T00:00:00Z", commit_id: "abc" },
    { id: 2, user: null, state: "PENDING", body: null, commit_id: null },
  ]);

  const r = s.run(s.repo, ["pr", "reviews", "9"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), [
    { id: 1, user: "ana", state: "CHANGES_REQUESTED", body: "no", submittedAt: "2026-01-01T00:00:00Z", commit: "abc" },
    { id: 2, user: null, state: "PENDING", body: "", submittedAt: null, commit: null },
  ]);
});

test("pr comments: grouped by thread, outdated lines and orphan replies", () => {
  const s = sandbox();
  s.route(`GET ${REPO}/pulls/9/comments?per_page=100&page=1`, [
    comment(1),
    comment(2, { line: null, original_line: 7 }),
    comment(3, { in_reply_to_id: 1, user: { login: "ramon" } }),
    comment(4, { line: null, original_line: null, subject_type: "file" }),
    comment(5, { in_reply_to_id: 99 }),
    comment(6, { in_reply_to_id: 1 }),
  ]);

  const r = s.run(s.repo, ["pr", "comments", "9"]);

  assert.equal(r.status, 0, r.err);
  const threads = r.json();
  assert.deepEqual(
    threads.map(({ id, line, outdated, replies }) => [id, line, outdated, replies.map((reply) => reply.id)]),
    [
      [1, 10, false, [3, 6]],
      [2, 7, true, []],
      [4, null, false, []],
      [5, 10, false, []],
    ],
  );
  assert.deepEqual(threads[0].replies[0], {
    id: 3, user: "ramon", body: "c3", url: "u3", createdAt: "2026-01-03T00:00:00Z",
  });
  assert.equal(threads[0].path, "src/a.ts");
});

test("pr reply: the id of a reply answers in its thread's first comment", () => {
  const s = sandbox();
  s.route(`GET ${REPO}/pulls/comments/3`, comment(3, { in_reply_to_id: 1 }));
  s.route(`GET ${REPO}/pulls/comments/1`, comment(1));
  s.route(`POST ${REPO}/pulls/9/comments/1/replies`, comment(7), 201);

  const viaReply = s.run(s.repo, ["pr", "reply", "9", "3", "--body", "- arreglado"]);
  const sent = s.calls().at(-1);
  const viaRoot = s.run(s.repo, ["pr", "reply", "9", "1", "--body", "ok"]);

  assert.equal(viaReply.status, 0, viaReply.err);
  assert.deepEqual(viaReply.json(), { id: 7, url: "u7" });
  assert.deepEqual(sent, { method: "POST", path: `${REPO}/pulls/9/comments/1/replies`, body: { body: "- arreglado" } });
  assert.equal(viaRoot.status, 0, viaRoot.err);
  assert.equal(s.calls().at(-1).path, `${REPO}/pulls/9/comments/1/replies`);
});

test("pr reply: a comment that does not exist exits with 1 without posting", () => {
  const s = sandbox();

  const r = s.run(s.repo, ["pr", "reply", "9", "3", "--body", "x"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /could not read comment 3/);
  assert.deepEqual(s.calls().map((call) => call.method), ["GET"]);
});

test("pr usage errors exit with 2 before calling GitHub, and there is no merge nor ready", () => {
  const s = sandbox();
  for (const args of [
    ["pr", "checks"],
    ["pr", "checks", "9", "10"],
    ["pr", "reply", "9", "3"],
    ["pr", "reply", "9", "x", "--body", "b"],
    ["pr", "reply", "9"],
    ["pr", "merge", "9"],
    ["pr", "ready", "9"],
  ]) {
    const r = s.run(s.repo, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(s.calls(), [], args.join(" "));
  }
});
