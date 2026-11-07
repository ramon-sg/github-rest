// Tests of `github-rest project …` against the fake gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sandbox } from "./helpers.mjs";

const P = "users/acme/projectsV2/3";

const FIELDS = [
  { id: 10, name: "Title", data_type: "title" },
  { id: 11, name: "Estimate", data_type: "number" },
  {
    id: 12,
    name: "Status",
    data_type: "single_select",
    options: [
      { id: "aa", name: { raw: "Todo", html: "Todo" } },
      { id: "bb", name: { raw: "Done", html: "Done" } },
    ],
  },
  { id: 13, name: "Notes", data_type: "text" },
];

function user(s, kind = "User") {
  s.route("GET users/acme", { login: "acme", type: kind });
}

test("project fields: id, name, type and options", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  const r = s.run(s.repo, ["project", "fields", "acme", "3"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), [
    { id: 10, name: "Title", type: "title" },
    { id: 11, name: "Estimate", type: "number" },
    {
      id: 12,
      name: "Status",
      type: "single_select",
      options: [
        { id: "aa", name: "Todo" },
        { id: "bb", name: "Done" },
      ],
    },
    { id: 13, name: "Notes", type: "text" },
  ]);
});

test("project fields: an org owner uses orgs/", () => {
  const s = sandbox();
  user(s, "Organization");
  s.route("GET orgs/acme/projectsV2/3/fields?per_page=100", FIELDS);
  const r = s.run(s.repo, ["project", "fields", "acme", "3"]);
  assert.equal(r.status, 0, r.err);
  assert.equal(s.calls().at(-1).path, "orgs/acme/projectsV2/3/fields?per_page=100");
});

test("project fields: missing owner or number exits 2", () => {
  const s = sandbox();
  for (const args of [
    ["project", "fields"],
    ["project", "fields", "acme"],
    ["project", "fields", "acme", "x"],
    ["project", "nope", "acme", "3"],
  ]) {
    assert.equal(s.run(s.repo, args).status, 2, args.join(" "));
    assert.deepEqual(s.calls(), []);
  }
});

test("project fields: an owner that does not exist exits 1", () => {
  const s = sandbox();
  const r = s.run(s.repo, ["project", "fields", "acme", "3"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /could not read the account acme/);
});

function item(id, n, values = {}, repo = "acme/widgets") {
  return {
    id,
    content_type: "Issue",
    archived_at: null,
    content: {
      number: n,
      title: `Issue ${n}`,
      state: n % 2 === 0 ? "open" : "closed",
      repository_url: `https://api.github.com/repos/${repo}`,
    },
    fields: Object.entries(values).map(([name, value]) => {
      const field = FIELDS.find((f) => f.name === name);
      return { id: field.id, name, data_type: field.data_type, value };
    }),
  };
}

const ITEMS = `${P}/items?fields[]=11&fields[]=12&per_page=100`;

test("project items: values by field name, with number and state of the issue", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  s.route(`GET ${ITEMS}`, [
    item(500, 4, {
      Estimate: 3,
      Status: { id: "aa", name: { raw: "Todo", html: "Todo" } },
    }),
    item(501, 5, { Estimate: null, Status: null }),
  ]);
  const r = s.run(s.repo, [
    "project",
    "items",
    "acme",
    "3",
    "--field",
    "Estimate",
    "--field",
    "status",
  ]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), [
    {
      id: 500,
      type: "Issue",
      repo: "acme/widgets",
      number: 4,
      state: "OPEN",
      title: "Issue 4",
      values: { Estimate: 3, Status: "Todo" },
    },
    {
      id: 501,
      type: "Issue",
      repo: "acme/widgets",
      number: 5,
      state: "CLOSED",
      title: "Issue 5",
      values: { Estimate: null, Status: null },
    },
  ]);
});

test("project items: without --field it asks for every field", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  s.route(`GET ${P}/items?fields[]=10&fields[]=11&fields[]=12&fields[]=13&per_page=100`, [
    item(500, 4, { Notes: "hola" }),
  ]);
  const r = s.run(s.repo, ["project", "items", "acme", "3"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json()[0].values, { Notes: "hola" });
});

test("project items: follows the after cursor of Link on the users/ path", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  const first = Array.from({ length: 100 }, (_, i) => item(i + 1, i + 1));
  s.route(`GET ${ITEMS}`, first, 200, {
    Link: '<https://api.github.com/user/9/projectsV2/3/items?per_page=100&fields%5B%5D=11&after=abc%3D>; rel="next"',
  });
  s.route(`GET ${ITEMS}&after=abc%3D`, [item(200, 200)], 200, {
    Link: '<https://api.github.com/user/9/projectsV2/3/items?before=x>; rel="prev"',
  });
  const r = s.run(s.repo, [
    "project", "items", "acme", "3", "--field", "Estimate", "--field", "Status",
  ]);
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().length, 101);
  assert.equal(r.err, "");
  assert.ok(s.calls().every((call) => !call.path.startsWith("user/")));
});

test("project items: an unknown --field exits 1 and names it", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  const r = s.run(s.repo, ["project", "items", "acme", "3", "--field", "Real"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /the project has no field "Real"/);
});

test("project items: repository and list values read as text", () => {
  const s = sandbox();
  user(s);
  const fields = [
    { id: 20, name: "Repository", data_type: "repository" },
    { id: 21, name: "Labels", data_type: "labels" },
  ];
  s.route(`GET ${P}/fields?per_page=100`, fields);
  s.route(`GET ${P}/items?fields[]=20&fields[]=21&per_page=100`, [
    {
      id: 1,
      content_type: "Issue",
      content: { number: 2, state: "open", repository_url: "https://api.github.com/repos/acme/widgets" },
      fields: [
        { id: 20, name: "Repository", data_type: "repository", value: { name: "widgets", full_name: "acme/widgets" } },
        { id: 21, name: "Labels", data_type: "labels", value: [{ name: "bug" }, { name: "area:ui" }] },
      ],
    },
  ]);
  const r = s.run(s.repo, ["project", "items", "acme", "3"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json()[0].values, { Repository: "acme/widgets", Labels: "bug, area:ui" });
});

const EXISTS = { message: "Content already exists in this project", status: "422" };

test("project add: posts the issue of -R and prints the item id", () => {
  const s = sandbox();
  user(s);
  s.route(`POST ${P}/items`, { id: 900, content_type: "Issue" }, 201);
  const r = s.run(s.repo, ["project", "add", "acme", "3", "--issue", "7", "-R", "other/thing"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), { id: 900, added: true });
  assert.deepEqual(s.calls().at(-1), {
    method: "POST",
    path: `${P}/items`,
    body: { type: "Issue", owner: "other", repo: "thing", number: 7 },
  });
});

test("project add: an issue already in the project gives its item", () => {
  const s = sandbox();
  user(s);
  s.route(`POST ${P}/items`, EXISTS, 422);
  s.route(`GET ${P}/items?per_page=100`, [item(500, 7, {}, "other/repo"), item(501, 7)]);
  const r = s.run(s.repo, ["project", "add", "acme", "3", "--issue", "7"]);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), { id: 501, added: false });
});

test("project add: an issue archived in the project exits 1 and says so", () => {
  const s = sandbox();
  user(s);
  s.route(`POST ${P}/items`, EXISTS, 422);
  s.route(`GET ${P}/items?per_page=100`, []);
  const r = s.run(s.repo, ["project", "add", "acme", "3", "--issue", "7"]);
  assert.equal(r.status, 1);
  assert.match(
    r.err,
    /issue acme\/widgets#7 is already in project acme\/3 but not in its item list: it is archived \(unarchive it first\) or was added seconds ago \(try again\)/,
  );
});

test("project add: without --issue exits 2", () => {
  const s = sandbox();
  for (const issueArg of [[], ["--issue", "x"]]) {
    const r = s.run(s.repo, ["project", "add", "acme", "3", ...issueArg]);
    assert.equal(r.status, 2);
    assert.deepEqual(s.calls(), []);
  }
});

function setup(s, items = [item(500, 7)]) {
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, FIELDS);
  s.route(`GET ${P}/items?per_page=100`, items);
  s.route(`PATCH ${P}/items/500`, { id: 500 });
}

const set = (s, ...extra) =>
  s.run(s.repo, ["project", "set", "acme", "3", "--issue", "7", ...extra]);

const writes = (s) => s.calls().filter((call) => call.method !== "GET");

test("project set: patches the item of the issue", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Estimate", "--value", "3.5");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), { item: 500, added: false, field: "Estimate", value: 3.5 });
  assert.deepEqual(writes(s), [
    { method: "PATCH", path: `${P}/items/500`, body: { fields: [{ id: 11, value: 3.5 }] } },
  ]);
});

test("project set: adds the issue when it is not in the project", () => {
  const s = sandbox();
  setup(s, []);
  s.route(`POST ${P}/items`, { id: 500 }, 201);
  const r = set(s, "--field", "Estimate", "--value", "2");
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().added, true);
  assert.deepEqual(writes(s).map((call) => `${call.method} ${call.path}`), [
    `POST ${P}/items`,
    `PATCH ${P}/items/500`,
  ]);
});

test("project set: matches the repo, not only the number", () => {
  const s = sandbox();
  setup(s, [item(499, 7, {}, "other/repo"), item(500, 7)]);
  const r = set(s, "--field", "Estimate", "--value", "1");
  assert.equal(r.status, 0, r.err);
  assert.equal(writes(s)[0].path, `${P}/items/500`);
});

test("project set: --field estimate finds Estimate", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "estimate", "--value", "1");
  assert.equal(r.status, 0, r.err);
  assert.equal(r.json().field, "Estimate");
});

test("project set: a name that matches several fields ignoring case exits 1", () => {
  const s = sandbox();
  setup(s);
  s.route(`GET ${P}/fields?per_page=100`, [
    ...FIELDS,
    { id: 14, name: "ESTIMATE", data_type: "number" },
  ]);
  const r = set(s, "--field", "estimate", "--value", "1");
  assert.equal(r.status, 1);
  assert.match(r.err, /"estimate" matches several fields: Estimate, ESTIMATE/);
  assert.deepEqual(writes(s), []);
});

test("project set: --value 1,5 exits 2 and does not write", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Estimate", "--value", "1,5");
  assert.equal(r.status, 2);
  assert.match(r.err, /Estimate is a number: use a dot for decimals \(1\.5\)/);
  assert.deepEqual(writes(s), []);
});

test("project set: a value that is not a number exits 2", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Estimate", "--value", "abc");
  assert.equal(r.status, 2);
  assert.match(r.err, /Estimate is a number: abc is not one/);
  assert.deepEqual(writes(s), []);
});

test('project set: --value "" sends null', () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Estimate", "--value", "");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(writes(s)[0].body, { fields: [{ id: 11, value: null }] });
  assert.equal(r.json().value, null);
});

test("project set: single_select sends the option id", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Status", "--value", "done");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(writes(s)[0].body, { fields: [{ id: 12, value: "bb" }] });
  assert.equal(r.json().value, "Done");
});

test("project set: an unknown option exits 2 and lists the options", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Status", "--value", "Blocked");
  assert.equal(r.status, 2);
  assert.match(r.err, /Status has no option "Blocked": Todo, Done/);
  assert.deepEqual(writes(s), []);
});

test("project set: text goes as it is; a field type it cannot write exits 2", () => {
  const s = sandbox();
  setup(s);
  const r = set(s, "--field", "Notes", "--value", "- a, b");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(writes(s)[0].body, { fields: [{ id: 13, value: "- a, b" }] });
  const t = set(s, "--field", "Title", "--value", "x");
  assert.equal(t.status, 2);
  assert.match(t.err, /Title is a title field: only number, text, date and single_select can be set/);
});

test("project set: missing --issue, --field or --value exits 2", () => {
  const s = sandbox();
  for (const args of [
    ["--field", "Estimate", "--value", "1"],
    ["--issue", "7", "--value", "1"],
    ["--issue", "7", "--field", "Estimate"],
  ]) {
    const r = s.run(s.repo, ["project", "set", "acme", "3", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(s.calls(), []);
  }
});

const GUIDE = /https:\/\/github\.com\/ramon-sg\/github-rest\/blob\/main\/docs\/projects-connector\.md/;

test("project: in Claude's cloud it exits 3 before calling GitHub and links the connector guide", () => {
  const s = sandbox();
  for (const args of [
    ["project", "fields", "acme", "3"],
    ["project", "items", "acme", "3"],
    ["project", "add", "acme", "3", "--issue", "7"],
    ["project", "set", "acme", "3", "--issue", "7", "--field", "Estimate", "--value", "2"],
  ]) {
    const r = s.run(s.repo, args, { CLAUDE_CODE_REMOTE: "true" });
    assert.equal(r.status, 3, args.join(" "));
    assert.match(r.err, /GitHub connector/);
    assert.match(r.err, GUIDE);
    assert.deepEqual(s.calls(), []);
  }
});

test("project: the cloud proxy's 403 also exits 3 when the variable is missing", () => {
  const s = sandbox();
  s.route(
    "GET users/acme",
    { message: "sessions are bound to their configured repositories" },
    403,
  );
  const r = s.run(s.repo, ["project", "fields", "acme", "3"]);
  assert.equal(r.status, 3);
  assert.match(r.err, GUIDE);
});

test("project: any other 403 exits 1 with GitHub's message", () => {
  const s = sandbox();
  user(s);
  s.route(`GET ${P}/fields?per_page=100`, { message: "Resource not accessible" }, 403);
  const r = s.run(s.repo, ["project", "fields", "acme", "3"]);
  assert.equal(r.status, 1);
  assert.match(r.err, /Resource not accessible/);
  assert.doesNotMatch(r.err, /connector/);
});
