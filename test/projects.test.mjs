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
