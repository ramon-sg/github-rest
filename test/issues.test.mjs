// Tests of `github-rest issue create|edit|list|comments|comment` and `label …` against the
// fake gh: each one checks the exact route and body GitHub receives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { issue, sandbox } from "./helpers.mjs";

const ISSUES = "repos/acme/widgets/issues";

const listPath = (query, page) =>
  `GET ${ISSUES}?${query}&per_page=100&page=${page}`;

test("issue create: labels split on commas, @me resolved, number and URL on stdout", () => {
  const s = sandbox();
  s.route("GET user", { login: "ramon" });
  s.route(
    `POST ${ISSUES}`,
    issue(50, {
      assignees: [{ login: "ramon" }],
      labels: [{ name: "bug" }, { name: "area:ui" }, { name: "size:S" }],
    }),
    201,
  );
  const body = `${s.tmp}/body.md`;
  writeFileSync(body, "## Qué pasa\n");

  const r = s.run(s.repo, [
    "issue", "create", "--title", "-x", "--body-file", body,
    "--label", "bug,area:ui", "--label", "size:S", "--assignee", "@me",
  ]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), {
    number: 50,
    url: "https://github.com/acme/widgets/issues/50",
  });
  assert.deepEqual(s.calls().at(-1), {
    method: "POST",
    path: ISSUES,
    body: {
      title: "-x",
      body: "## Qué pasa\n",
      labels: ["bug", "area:ui", "size:S"],
      assignees: ["ramon"],
    },
  });
  assert.equal(r.err, "");
});

test("issue create: an assignee or label GitHub dropped is a warning, the issue exists", () => {
  const s = sandbox();
  s.route(`POST ${ISSUES}`, issue(50, { assignees: [], labels: [{ name: "bug" }] }), 201);

  const r = s.run(s.repo, [
    "issue", "create", "--title", "T", "--body", "", "--assignee", "bob",
    "--label", "bug,size:S",
  ]);

  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().number, 50);
  assert.match(r.err, /GitHub did not assign bob to issue #50/);
  assert.match(r.err, /GitHub did not add size:S to issue #50\./);
});

test("issue edit: fields in one PATCH, then the labels to add and to remove", () => {
  const s = sandbox();
  s.route(`PATCH ${ISSUES}/42`, issue(42));
  s.route(`POST ${ISSUES}/42/labels`, []);
  s.route(`DELETE ${ISSUES}/42/labels/area%3Aui`, []);
  s.route(`DELETE ${ISSUES}/42/labels/needs%20triage`, []);

  const r = s.run(s.repo, [
    "issue", "edit", "42", "--title", "New", "--body", "B", "--close",
    "--add-label", "bug", "--remove-label", "area:ui,needs triage",
  ]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.calls(), [
    { method: "PATCH", path: `${ISSUES}/42`, body: { title: "New", body: "B", state: "closed" } },
    { method: "POST", path: `${ISSUES}/42/labels`, body: { labels: ["bug"] } },
    { method: "DELETE", path: `${ISSUES}/42/labels/area%3Aui` },
    { method: "DELETE", path: `${ISSUES}/42/labels/needs%20triage` },
  ]);
});

test("issue edit: only labels makes no PATCH, and --reopen sends state open", () => {
  const s = sandbox();
  s.route(`POST ${ISSUES}/42/labels`, []);
  s.route(`PATCH ${ISSUES}/42`, issue(42));

  assert.equal(s.run(s.repo, ["issue", "edit", "42", "--add-label", "bug"]).status, 0);
  assert.deepEqual(s.calls().map((call) => call.method), ["POST"]);
  assert.equal(s.run(s.repo, ["issue", "edit", "42", "--reopen"]).status, 0);
  assert.deepEqual(s.calls().at(-1).body, { state: "open" });
});

test("issue edit: removing a label the issue lacks is fine; any other 404 exits with 1", () => {
  const s = sandbox();
  s.route(`DELETE ${ISSUES}/42/labels/bug`, { message: "Label does not exist" }, 404);

  assert.equal(s.run(s.repo, ["issue", "edit", "42", "--remove-label", "bug"]).status, 0);
  const r = s.run(s.repo, ["issue", "edit", "43", "--remove-label", "bug"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /could not remove bug from issue #43/);
});

test("issue list: query by state and labels, no PRs, newest first", () => {
  const s = sandbox();
  s.route(listPath("state=all&labels=bug%2Carea%3Aui", 1), [
    issue(9),
    issue(8, { pull_request: {} }),
    issue(7, { state: "closed" }),
  ]);

  const r = s.run(s.repo, ["issue", "list", "--state", "all", "--label", "bug,area:ui"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json().map((found) => [found.number, found.state]), [[9, "OPEN"], [7, "CLOSED"]]);
});

test("issue list --missing-heading: keeps issues whose body lacks it, across pages, up to --limit", () => {
  const s = sandbox();
  const withHeading = { body: "**Rama sugerida:** `fix/1-x`" };
  const first = Array.from({ length: 100 }, (_, i) => issue(500 - i, withHeading));
  first[3] = issue(497, { body: "sin rama" });
  s.route(listPath("state=open", 1), first);
  s.route(listPath("state=open", 2), [issue(400, { body: null }), issue(399), issue(398)]);

  const r = s.run(s.repo, [
    "issue", "list", "--missing-heading", "**Rama sugerida", "--limit", "2",
  ]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json().map((found) => found.number), [497, 400]);
  assert.equal(s.calls().length, 2);
});

test("issue list: a full last page at the ceiling warns that the list was cut", () => {
  const s = sandbox();
  for (let page = 1; page <= 10; page += 1)
    s.route(listPath("state=open", page), Array.from({ length: 100 }, (_, i) => issue(page * 1000 + i, { pull_request: {} })));

  const r = s.run(s.repo, ["issue", "list"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), []);
  assert.equal(s.calls().length, 10);
  assert.match(r.err, /the list was cut short/);
});

test("issue comments and issue comment: read the conversation and add to it", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/42/comments?per_page=100&page=1`, [
    { id: 1, user: { login: "ana" }, body: "hola", html_url: "u1", created_at: "2026-01-01T00:00:00Z" },
    { id: 2, user: null, body: null, html_url: "u2", created_at: "2026-01-02T00:00:00Z" },
  ]);
  s.route(`POST ${ISSUES}/42/comments`, { id: 3, html_url: "u3" }, 201);

  const read = s.run(s.repo, ["issue", "comments", "42"]);
  const added = s.run(s.repo, ["issue", "comment", "42", "--body", "- listo"]);

  assert.equal(read.status, 0, read.err);
  assert.deepEqual(read.json(), [
    { id: 1, user: "ana", body: "hola", url: "u1", createdAt: "2026-01-01T00:00:00Z" },
    { id: 2, user: null, body: "", url: "u2", createdAt: "2026-01-02T00:00:00Z" },
  ]);
  assert.equal(added.status, 0, added.err);
  assert.deepEqual(added.json(), { id: 3, url: "u3" });
  assert.deepEqual(s.calls().at(-1), { method: "POST", path: `${ISSUES}/42/comments`, body: { body: "- listo" } });
});

test("label list: name, color and description", () => {
  const s = sandbox();
  s.route("GET repos/acme/widgets/labels?per_page=100&page=1", [
    { name: "bug", color: "d73a4a", description: "Algo falla" },
    { name: "spike", color: "fbca04", description: null },
  ]);

  const r = s.run(s.repo, ["label", "list"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), [
    { name: "bug", color: "d73a4a", description: "Algo falla" },
    { name: "spike", color: "fbca04", description: "" },
  ]);
});

test("label create: the color without # and in lowercase", () => {
  const s = sandbox();
  s.route("POST repos/acme/widgets/labels", { name: "size:S" }, 201);

  const r = s.run(s.repo, ["label", "create", "size:S", "--color", "#C5DEF5", "--description", "Chica"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), { name: "size:S", created: true });
  assert.deepEqual(s.calls().at(-1).body, { name: "size:S", color: "c5def5", description: "Chica" });
});

test("label create: an existing label fails, and with --force it is updated", () => {
  const s = sandbox();
  s.route(
    "POST repos/acme/widgets/labels",
    { message: "Validation Failed", errors: [{ resource: "Label", code: "already_exists", field: "name" }] },
    422,
  );
  s.route("PATCH repos/acme/widgets/labels/area%3Aui", { name: "area:ui" });

  const plain = s.run(s.repo, ["label", "create", "area:ui", "--color", "1d76db"]);
  const forced = s.run(s.repo, ["label", "create", "area:ui", "--color", "1d76db", "--force"]);

  assert.equal(plain.status, 1);
  assert.match(plain.err, /already exists \(add --force to update it\)/);
  assert.equal(forced.status, 0, forced.err);
  assert.deepEqual(forced.json(), { name: "area:ui", created: false });
  assert.deepEqual(s.calls().at(-1), {
    method: "PATCH",
    path: "repos/acme/widgets/labels/area%3Aui",
    body: { color: "1d76db" },
  });
});

test("label create --force: a 422 that is not 'already exists' does not update", () => {
  const s = sandbox();
  s.route(
    "POST repos/acme/widgets/labels",
    { message: "Validation Failed", errors: [{ resource: "Label", code: "invalid", field: "color" }] },
    422,
  );

  const r = s.run(s.repo, ["label", "create", "x", "--force"]);

  assert.equal(r.status, 1);
  assert.deepEqual(s.calls().map((call) => call.method), ["POST"]);
});

test("issue and label usage errors exit with 2 before calling GitHub", () => {
  const s = sandbox();
  for (const args of [
    ["issue", "create", "--title", "T"],
    ["issue", "create", "--body", "B"],
    ["issue", "edit", "42"],
    ["issue", "edit", "42", "--close", "--reopen"],
    ["issue", "list", "--state", "merged"],
    ["issue", "list", "--limit", "0"],
    ["issue", "comment", "42"],
    ["issue", "comments"],
    ["issue", "comments", "42", "43"],
    ["label", "create"],
    ["label", "create", "x", "--color", "blue"],
    ["label", "nope"],
  ]) {
    const r = s.run(s.repo, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(s.calls(), [], args.join(" "));
  }
});
