# Publicar sin dependencias y CI con Bun — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `@ramon-sg/github-rest` se publique sin `dependencies`, con un `dist/` que corre igual con `bunx --bun` y `npx --yes`, y que CI lo pruebe con Node y con Bun.

**Architecture:** El paquete ya no tiene dependencias en tiempo de ejecución: `dist/` (salida de `tsc`) solo importa `node:*` y archivos propios. Por eso **no se agrega bundler**: la salida de `tsc` ya es el paquete "con todo adentro", y se mantienen los `.d.ts` de la librería sin cambios. Lo que falta es que eso no se rompa sin que nadie lo vea: un test de empaquetado (sin `dependencies`, `dist/` solo con imports `node:*` o relativos, sin `src/` ni `test/`), un `--version` para que CI corra el bin, y un job de Bun en CI que corre el suite y el paquete real con `bunx --bun` y `npx --yes`. Es el mismo camino que tomó `@ramon-sg/runner` 1.0.0 (sin bundler, `test/pack.test.mjs`, job `bun`).

**Tech Stack:** TypeScript 5.9, Node ≥ 20, Bun 1.4.4, `node:test` (también bajo `bun test`), GitHub Actions.

**Spec:** issue https://github.com/ramon-sg/github-rest/issues/13 y el diseño https://github.com/ramon-sg/agent-kitchen/blob/main/docs/superpowers/specs/2026-11-20-bunx-runner-design.md (sección "Las herramientas se publican con sus dependencias adentro", etapa 2). Notas del spike: `../runner/docs/spike-2026-11-20.md`.

## Global Constraints

- Sin cambios de comportamiento en comandos existentes. Lo único nuevo es `--version`.
- El `package.json` publicado queda sin `dependencies` (hoy ya no tiene; el test lo fija).
- Comandos según `runner`: `bun` → `bunx --bun <paquete>@<versión> <args>`; `node` → `npx --yes <paquete>@<versión> <args>`.
- Los tests no corren `npx`/`bunx` contra la red (`npx` sin red se cuelga). El paquete real con `bunx`/`npx` se prueba solo en CI, con un `.tgz` local.
- Solo macOS/Linux.
- Código, comentarios, README y mensajes en inglés, como el resto del repo. Commits en español.
- Versión nueva: **0.7.0** (minor; es la que nombra el ejemplo de `runner.json` del diseño).

## Review Focus

- `--version` desde el paquete instalado (no desde el repo): `dist/cli.js` lee `../package.json` relativo a `import.meta.url`, que existe también dentro de `node_modules` y de la caché de `bunx`. Lo cubre el paso de CI con el `.tgz` (Task 2).
- `--version` junto a un comando (`github-rest issue view 1 --version`): imprime la versión y sale 0 sin llamar a `gh`. Test en Task 1.
- Un import futuro de un paquete de npm en `src/` que pase `tsc` y rompa `bunx` sin red: test de imports de `dist/` en Task 1.
- El suite bajo `bun test`: `helpers.mjs` corre el CLI con `process.execPath`, que bajo Bun es `bun`, así que el job de Bun prueba el CLI con Bun de verdad. Lo verifica correr `bun test` localmente en Task 2.
- El test que arma un PATH "con solo node y git" (`helpers.mjs:148-152`) enlaza `process.execPath` como `node`: bajo Bun queda un `node` que es Bun. Debe seguir pasando; si no, se ajusta en Task 2 sin cambiar lo que prueba.

---

### Task 1: `--version` y test de empaquetado

**Files:**
- Modify: `src/args.ts` (`OPTIONS` y `Flags`: `version`)
- Modify: `src/cli.ts` (`main`, `USAGE`)
- Create: `test/pack.test.mjs`
- Modify: `test/ops.test.mjs` (test de `--version`)

**Interfaces:**
- Produces: `github-rest --version` imprime `<version de package.json>\n` en stdout y sale 0. Task 2 lo usa en CI.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/ops.test.mjs`, junto al test de `--help`:

```js
test("--version prints the package version, also next to a command", () => {
  const s = sandbox();
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const args of [["--version"], ["issue", "view", "1", "--version"]]) {
    const r = s.run(s.repo, args);
    assert.equal(r.status, 0, args.join(" "));
    assert.equal(r.out, `${version}\n`);
  }
  assert.deepEqual(s.calls(), []);
});
```

`test/pack.test.mjs`, siguiendo `../runner/test/pack.test.mjs`:

- `"the package has the build and no tests nor sources"`: `npm pack --dry-run --json --ignore-scripts`; incluye `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE`; ningún archivo empieza con `src/` ni `test/`.
- `"the package has no runtime dependencies"`: `Object.keys(pkg.dependencies ?? {})` es `[]`, y lo mismo `peerDependencies` y `optionalDependencies`.
- `"dist only imports node builtins and its own files"`: para cada `dist/**/*.js`, todo especificador de `import … from "x"`, `import("x")` y `export … from "x"` empieza con `node:` o con `./`/`../`. Mensaje de falla con archivo y especificador.
- `"the bin is dist/cli.js and starts with a node shebang"`: `pkg.bin["github-rest"] === "dist/cli.js"` y la primera línea es `#!/usr/bin/env node` (el diseño cuenta con eso para `--bun`).

- [ ] **Step 2: Correrlos y ver que fallen**

Run: `npm test`
Expected: FALLA solo el test de `--version` (opción desconocida, sale 2). Los de `pack.test.mjs` pasan ya: fijan lo que hoy es cierto.

- [ ] **Step 3: Implementar**

- `src/args.ts`: `version: { type: "boolean", short: "v" }` en `OPTIONS` y `version?: boolean` en `Flags` (`-v` está libre: hoy solo hay `-R` y `-h`).
- `src/cli.ts`: en `main`, después de `help`, `if (flags.version) { process.stdout.write(`${packageVersion()}\n`); return 0; }`. `packageVersion(): string` lee `new URL("../package.json", import.meta.url)` con `readFileSync` y devuelve `.version`. Agregar `github-rest --version` a `USAGE`.

- [ ] **Step 4: Correr y ver que pasen**

Run: `npm test`
Expected: PASS, todo el suite.

- [ ] **Step 5: Commit**

```bash
git add src/args.ts src/cli.ts test/ops.test.mjs test/pack.test.mjs
git commit -m "feat: github-rest --version y test del paquete publicado"
```

### Task 2: CI con Bun y el paquete real con `bunx`/`npx`

**Files:**
- Modify: `.tool-versions` (agregar `bun 1.4.4`)
- Modify: `.github/workflows/test.yml`
- Modify: `test/helpers.mjs` solo si `bun test` falla por el PATH "solo node y git"

**Interfaces:**
- Consumes: `github-rest --version` (Task 1).

- [ ] **Step 1: Correr el suite con Bun localmente**

Run: `npx tsc && bun test --timeout 20000 test/`
Expected: PASS. Si algo falla, es un problema de Bun con una API de Node o con el `node` enlazado a `process.execPath`; se arregla en el test sin cambiar lo que prueba, o en `src/` solo si el CLI de verdad falla con Bun (y entonces con un test que lo pruebe). Anotar en el PR qué fue.

- [ ] **Step 2: Job `bun` en `test.yml`**

Mantener el job `test` (matriz Node 20 y 24) y agregar `bun`, como el de `../runner/.github/workflows/test.yml`: `setup-node` 24, `oven-sh/setup-bun@v2` con `bun-version-file: .tool-versions`, `npm ci`, `npx tsc`, y luego:

```yaml
      - run: bun dist/cli.js --version
      - run: bun test --timeout 20000 test/
      - name: The packed tarball runs with bunx --bun and npx --yes
        run: |
          npm pack
          tgz="$PWD/$(ls ramon-sg-github-rest-*.tgz)"
          want="$(node -p 'require("./package.json").version')"
          dir="$(mktemp -d)" && cd "$dir"
          test "$(npx --yes -p "$tgz" github-rest --version)" = "$want"
          bun add "$tgz" && test "$(bun x --bun github-rest --version)" = "$want"
```

(`npx` con la ruta del `.tgz` sola falla; hace falta `-p <tgz> <bin>`, según el spike.)

- [ ] **Step 3: Verificar el paso del `.tgz` localmente**

Run: el bloque `run` del paso anterior, desde la raíz del repo.
Expected: sale 0 y las dos líneas comparan igual. Borrar el `.tgz` después (está fuera de `files`, pero no se commitea).

- [ ] **Step 4: Commit y push de la rama; ver CI**

```bash
git add .tool-versions .github/workflows/test.yml
git commit -m "ci: job con Bun y prueba del paquete con bunx y npx"
```

Run: `gh pr checks --watch` tras abrir el PR (Task 3).
Expected: `test (20)`, `test (24)` y `bun` en verde.

### Task 3: versión 0.7.0, README y PR

**Files:**
- Modify: `package.json`, `package-lock.json` (`version` → `0.7.0`)
- Modify: `README.md` (líneas 9 y 122)

- [ ] **Step 1: Versión**

Run: `npm version 0.7.0 --no-git-tag-version`
Expected: `package.json` y `package-lock.json` dicen 0.7.0.

- [ ] **Step 2: README**

- Línea 9: decir que corre con Node 20+ o con Bun, con los dos comandos fijados: `bunx --bun @ramon-sg/github-rest@<version>` y `npx --yes @ramon-sg/github-rest@<version>`, y que el paquete no tiene dependencias en tiempo de ejecución.
- Línea 122: `npx @ramon-sg/github-rest project set …` pasa al comando fijado del ejecutor del repo (`.agents/runner.json`), con los dos ejemplos.
- `--version` en la lista de la sección CLI.

- [ ] **Step 3: Verificar**

Run: `npm test && npx tsc && bun test --timeout 20000 test/`
Expected: PASS en los dos.

- [ ] **Step 4: Commit y PR**

```bash
git add package.json package-lock.json README.md
git commit -m "chore: 0.7.0"
```

PR contra `main` con `Closes #13`, que explique por qué no hay bundler (cero dependencias; el test de imports de `dist/` obliga a agregar uno si alguna vez entra una).

- [ ] **Step 5: Publicar (tras el merge, lo decide el usuario)**

Tag `v0.7.0` en `main` → `publish.yml` publica. Luego, sin red de por medio en los tests, a mano:
`bunx --bun @ramon-sg/github-rest@0.7.0 --version` y `npx --yes @ramon-sg/github-rest@0.7.0 --version` → `0.7.0`. Marcar las casillas del issue.
