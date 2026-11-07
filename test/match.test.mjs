// Tests of the naming rules: which branch belongs to an issue and which body closes or names it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { closesIssue, issueBranchRe, refsIssue } from "../dist/match.js";

test("issue branch: <n>- at the start or after a /", () => {
  const re = issueBranchRe(42);
  assert.ok(re.test("feat/42-x"));
  assert.ok(re.test("42-x"));
  assert.ok(re.test("ramon/feat/42-x"));
  assert.ok(!re.test("feat/420-x"));
  assert.ok(!re.test("x42-y"));
});

test("closing: GitHub's words, without confusing #420", () => {
  for (const body of [
    "Closes #42",
    "fixes #42.",
    "Resolved #42",
    "close #42",
    "FIXED #42",
  ])
    assert.ok(closesIssue(body, 42), body);
  assert.ok(!closesIssue("Closes #420", 42));
  assert.ok(!closesIssue("Part of #42", 42));
  assert.ok(!closesIssue(null, 42));
});

test("work mention: closing, Part of or Parte de", () => {
  assert.ok(refsIssue("Parte de #42 (PR 2 de 3).", 42));
  assert.ok(refsIssue("Part of #42", 42));
  assert.ok(refsIssue("Closes #42", 42));
  assert.ok(!refsIssue("Part of #420. Ver #42.", 42));
});

test("closing and work phrases with a colon", () => {
  for (const body of ["Closes: #42", "Fixes:#42", "resolved:  #42"])
    assert.ok(closesIssue(body, 42), body);
  assert.ok(!closesIssue("Closes: #420", 42));
  assert.ok(refsIssue("Part of: #42", 42));
  assert.ok(refsIssue("Parte de: #42", 42));
  assert.ok(!refsIssue("Part of: #421", 42));
  assert.ok(!closesIssue("prefixes: #42", 42));
});

test("prIssues: the branch number, at the start or after a /", async () => {
  const { prIssues } = await import("../dist/index.js");
  assert.deepEqual(prIssues("feat/12-x", ""), [12]);
  assert.deepEqual(prIssues("12-x", null), [12]);
  assert.deepEqual(prIssues("feat/120-x", ""), [120]);
  assert.ok(!prIssues("feat/120-x", "").includes(12));
  assert.deepEqual(prIssues("x12-y", ""), []);
  assert.deepEqual(prIssues("main", undefined), []);
});

test("prIssues: branch and closing phrases, without repeats and in order", async () => {
  const { prIssues } = await import("../dist/index.js");
  assert.deepEqual(prIssues("feat/19-x", "Closes #19\n\nCloses #6"), [6, 19]);
});

test("prIssues: Part of, Parte de and closing words, with or without a colon", async () => {
  const { prIssues } = await import("../dist/index.js");
  for (const body of ["Part of #12", "Parte de: #12", "Fixes #12", "resolved:  #12"])
    assert.deepEqual(prIssues("main", body), [12], body);
  assert.deepEqual(prIssues("main", "Ver #12. prefixes: #13"), []);
});

test("prIssues: #120 is not #12, and #012 is not 12", async () => {
  const { prIssues } = await import("../dist/index.js");
  assert.deepEqual(prIssues("main", "Closes #120"), [120]);
  assert.deepEqual(prIssues("main", "Closes #012"), []);
  assert.deepEqual(prIssues("feat/012-x", ""), []);
});

test("prIssues: empty or null body leaves only the branch", async () => {
  const { prIssues } = await import("../dist/index.js");
  assert.deepEqual(prIssues("feat/7-x", ""), [7]);
  assert.deepEqual(prIssues("feat/7-x", null), [7]);
});

test("prIssues agrees with issueBranchRe and refsIssue", async () => {
  const { issueBranchRe, prIssues, refsIssue } = await import("../dist/index.js");
  const cases = [
    ["feat/19-x", "Closes #19\nCloses #6"],
    ["ramon/feat/42-x", "Part of: #420. Ver #42."],
    ["12-x/34-y", "Parte de #5, fixes #8 and close #9"],
    ["main", "Closes: #3 prefixes: #4 #5"],
  ];
  for (const [branch, body] of cases) {
    const named = prIssues(branch, body);
    for (let n = 1; n <= 500; n++) {
      const expected = issueBranchRe(n).test(branch) || refsIssue(body, n);
      assert.equal(named.includes(n), expected, `${branch} | ${body} | #${n}`);
    }
  }
});
