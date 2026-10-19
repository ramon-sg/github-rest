// Tests of repo detection: the origin's URL forms (Claude cloud's git proxy among them) and GH_REPO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { originRepo } from "../dist/repo.js";
import { issue, sandbox } from "./helpers.mjs";

function originOf(url) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "github-rest-origin-")));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", url]);
  return originRepo(dir);
}

test("origin: https, ssh and scp forms, with or without .git", () => {
  assert.equal(originOf("https://github.com/acme/widgets.git"), "acme/widgets");
  assert.equal(originOf("https://github.com/acme/widgets"), "acme/widgets");
  assert.equal(originOf("git@github.com:acme/widgets.git"), "acme/widgets");
  assert.equal(originOf("ssh://git@github.com/acme/widgets"), "acme/widgets");
});

test("origin: Claude cloud's local git proxy", () => {
  assert.equal(
    originOf("http://local_proxy@127.0.0.1:12345/git/rsat/abastio"),
    "rsat/abastio",
  );
  assert.equal(
    originOf("https://user:pass@proxy.local/git/acme/widgets.git"),
    "acme/widgets",
  );
  assert.equal(originOf("http://127.0.0.1:8080/git/acme/widgets"), "acme/widgets");
  assert.equal(originOf("http://127.0.0.1:8080/acme/widgets/extra"), null);
});

test("GH_REPO: used outside a checkout, also as host/owner/repo", () => {
  const s = sandbox();
  s.route("GET repos/other/thing/issues/1", issue(1));
  for (const value of ["other/thing", "github.com/other/thing"]) {
    const r = s.run(s.outside, ["issue", "view", "1"], { GH_REPO: value });
    assert.equal(r.status, 0, r.err);
    assert.equal(s.calls().at(-1).path, "repos/other/thing/issues/1");
  }
});

test("GH_REPO: beats the origin, -R beats GH_REPO", () => {
  const s = sandbox();
  s.route("GET repos/other/thing/issues/1", issue(1));
  s.route("GET repos/third/one/issues/1", issue(1));
  assert.equal(
    s.run(s.repo, ["issue", "view", "1"], { GH_REPO: "other/thing" }).status,
    0,
  );
  assert.equal(s.calls().at(-1).path, "repos/other/thing/issues/1");
  const r = s.run(s.repo, ["issue", "view", "1", "-R", "third/one"], {
    GH_REPO: "other/thing",
  });
  assert.equal(r.status, 0, r.err);
  assert.equal(s.calls().at(-1).path, "repos/third/one/issues/1");
});

test("GH_REPO: a value that is not [host/]owner/repo exits with 2", () => {
  const s = sandbox();
  const r = s.run(s.outside, ["issue", "view", "1"], { GH_REPO: "noslash" });
  assert.equal(r.status, 2);
  assert.match(r.err, /GH_REPO/);
});
