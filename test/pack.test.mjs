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

/**
 * Specifiers of `from "x"`, `import "x"`, `import("x")`, `require("x")` and
 * `createRequire(…)("x")`, with any quotes.
 */
const SPECIFIERS =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|Require\s*\([^)]*\)\s*\(\s*)["'`]([^"'`]+)["'`]/g;
/** Block comments and whole-line comments: their prose says "from `x`" too. */
const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;
const ALLOWED = /^(node:|\.\.?\/)/;

/** Specifiers in `code` that are not a node builtin nor a file of the package. */
function foreignImports(code) {
  return [...code.replace(COMMENTS, "").matchAll(SPECIFIERS)]
    .map(([, specifier]) => specifier)
    .filter((specifier) => !ALLOWED.test(specifier));
}

test("the import scan sees every way to load a package", () => {
  for (const code of [
    'import { a } from "pkg";',
    'import {\n  a,\n  b,\n} from "pkg";',
    'import "pkg";',
    'export * from "pkg";',
    'export * as ns from "pkg";',
    'const m = await import("pkg");',
    "const m = await import(`pkg`);",
    'const m = require("pkg");',
    'const m = createRequire(import.meta.url)("pkg");',
    'import type { A } from "pkg";',
    'export declare function f(): import("pkg").A;',
  ])
    assert.deepEqual(foreignImports(code), ["pkg"], code);
  assert.deepEqual(
    foreignImports('import { x } from "node:fs";\nexport * from "./a.js";'),
    [],
  );
  assert.deepEqual(
    foreignImports('/**\n * Derived from `OPTIONS`.\n */\n// import "pkg"\nconst u = "https://x";'),
    [],
  );
});

test("dist only imports node builtins and its own files, also in its types", () => {
  const dist = join(ROOT, "dist");
  const files = readdirSync(dist, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"));
  assert.ok(files.length > 0, "dist/ is empty: run tsc first");
  for (const file of files)
    assert.deepEqual(
      foreignImports(readFileSync(join(dist, file), "utf8")),
      [],
      `dist/${file}`,
    );
});

test("the bin is dist/cli.js and starts with a node shebang", () => {
  assert.equal(pkg.bin["github-rest"], "dist/cli.js");
  const first = readFileSync(join(ROOT, "dist", "cli.js"), "utf8").split("\n")[0];
  assert.equal(first, "#!/usr/bin/env node");
});
