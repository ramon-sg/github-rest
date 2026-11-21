// Tests of the published package: what `npm pack` puts in it, and that dist/ runs without
// installing anything (no runtime dependencies, only node: builtins and its own files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

test("the package has the build and no tests nor sources", () => {
  const [pack] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  );
  const files = pack.files.map((file) => file.path);
  for (const file of [
    "dist/cli.js",
    "dist/index.js",
    "dist/index.d.ts",
    "package.json",
    "README.md",
    "LICENSE",
  ])
    assert.ok(files.includes(file), `${file} is not in the package`);
  assert.deepEqual(
    files.filter((file) => file.startsWith("src/") || file.startsWith("test/")),
    [],
  );
});

test("the package has no runtime dependencies", () => {
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies"])
    assert.deepEqual(Object.keys(pkg[key] ?? {}), [], key);
});

test("dist only imports node builtins and its own files", () => {
  const dist = join(ROOT, "dist");
  const specifiers =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  const files = readdirSync(dist, { recursive: true }).filter((file) =>
    String(file).endsWith(".js"),
  );
  assert.ok(files.length > 0, "dist/ has no .js files: run tsc first");
  for (const file of files) {
    const code = readFileSync(join(dist, String(file)), "utf8");
    for (const [, specifier] of code.matchAll(specifiers))
      assert.match(
        specifier,
        /^(node:|\.\.?\/)/,
        `dist/${file} imports ${specifier}`,
      );
  }
});

test("the bin is dist/cli.js and starts with a node shebang", () => {
  assert.equal(pkg.bin["github-rest"], "dist/cli.js");
  const first = readFileSync(join(ROOT, "dist", "cli.js"), "utf8").split("\n")[0];
  assert.equal(first, "#!/usr/bin/env node");
});
