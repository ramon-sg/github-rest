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
