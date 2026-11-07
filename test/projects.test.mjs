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
