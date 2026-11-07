# Projects v2 por REST y `pr commits` — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Probar en la nube de Claude los endpoints REST de Projects v2 y sumar `project fields|items|add|set` y `pr commits` al CLI y a la librería, solo con REST.

**Architecture:** Un módulo nuevo `src/projects.ts` (librería) y `src/project-commands.ts` (CLI), con el mismo patrón que `labels.ts`/`issue-commands.ts`. Los items se paginan con cursor (`after=` del header `Link`), así que `gh.ts` gana una lectura con `gh api -i` y un paginador por cursor. `pr commits` va en `pulls.ts` y `pr-commands.ts` y usa el `ghGetAll` de siempre.

**Tech Stack:** TypeScript 5.9, Node ≥ 20, `node:test`, `gh api`; tests contra `test/fake-gh.mjs`.

**Spec:** issue https://github.com/ramon-sg/github-rest/issues/6

## Global Constraints

- Solo REST con `gh api`. `sandbox().run` ya falla si algo llama a `graphql`.
- JSON en stdout y avisos en stderr. Código de salida 0 si sale bien, 1 si falla GitHub y 2 si el uso es incorrecto (`UsageError`).
- El dueño puede ser usuario u organización. Las rutas son `users/{owner}/projectsV2/{n}/…` o `orgs/{owner}/projectsV2/{n}/…`.
- Endpoints del issue, sin cambios:
  - `GET …/fields`
  - `GET …/items?fields[]=<id>&per_page=100`
  - `GET …/items/{item_id}`
  - `POST …/items` con `{"type":"Issue","owner","repo","number"}`
  - `PATCH …/items/{item_id}` con `{"fields":[{"id":<id>,"value":<v>}]}`
  - `GET repos/{owner}/{repo}/pulls/{n}/commits`
- Los items se paginan siguiendo el cursor `after` del `Link rel="next"`, agregado a **nuestra** ruta `users/{owner}/…`. No se sigue la URL del `Link`, que apunta a `user/<id>/…`: es otra ruta, que el proxy de la nube podría tratar distinto.
- Código, comentarios, README y mensajes en inglés, como el resto del repo. Commits en español, como el log.
- Versión: 0.4.0.

## Review Focus

1. **La misma issue en dos repos del proyecto:** `project set --issue 5` debe tomar el item del repo `-R`, no cualquier item con número 5. (Test en Task 6.)
2. **Nombre de campo con otra capitalización:** `--field estimate` encuentra `Estimate` si es el único que coincide sin importar mayúsculas. Si hay más de uno, da error. (`fieldByName` se define en Task 3 y el test va en Task 6.)
3. **Más de 100 items (abastio tiene 178):** `project items` lee todas las páginas por cursor y avisa si llega al tope. (Test en Task 4.)
4. **Valor no numérico o con coma decimal (`--value 1,5`) en un campo number:** sale con 2 y dice que use punto. No manda el PATCH. (Test en Task 6.)
5. **Issue archivada en el proyecto:** no aparece en `GET items`, así que `set` hace POST. Se usa el `id` que devuelve el POST, sea un item nuevo o uno que ya existía, y nunca se vuelve a listar. (Test en Task 6. El comportamiento real se ve en el probe de Task 1.)

---

### Task 1: Probe en la nube (manual, define el alcance)

**Files:**
- Create: `scripts/probe-projects.sh`

El script imprime una tabla markdown `| # | endpoint | HTTP | nota |`. Lee el código con `gh api -i … | head -1`.

- Argumentos: `<owner> <project-n> <repo> <issue-n> <pr-n> [<archived-item-id>]`.
- Pasos:
  1. GET fields. Busca un campo number llamado `Probe` y sale con error si no está.
  2. GET items con `fields[]=<Probe>`, mostrando el `Link`.
  3. POST add de la issue.
  4. GET del item.
  5. PATCH `Probe=1`, después GET para confirmar, después PATCH `null` para dejarlo como estaba.
  6. `DELETE …/items/{id}` solo si el POST creó el item. Lo sabe porque el item no estaba en el GET items de antes.
  7. GET pulls/commits.
  8. GET `items?q=is:archived` (anota si la respuesta trae algún `archived_at` no nulo).
  9. Si se pasó un id archivado: GET y PATCH sobre ese item, y después lo devuelve a su valor.
  10. GET `user` con `-i`, mostrando `X-Oauth-Scopes` (puede venir vacío detrás del proxy).

- [ ] **Step 1:** Escribir el script y correrlo en local contra un proyecto de prueba. Antes, el usuario crea un proyecto `probe` con un campo number `Probe`, porque REST no crea proyectos.
  Run: `bash scripts/probe-projects.sh ramon-sg <n> ramon-sg/github-rest 6 5`
  Expected: todas las filas en 2xx.
- [ ] **Step 2:** Commit (`chore: script para probar la API REST de Projects`), push de la rama y abrir un PR draft. Así la sesión en la nube puede hacer checkout.
- [ ] **Step 3 (usuario, en una sesión de Claude en la nube):** correr el mismo comando y pegar la tabla como comentario en el issue #6.
- [ ] **Step 4: Gate.**
  - Si 1, 2 y 6 dan 2xx en la nube, siguen las Tasks 2 a 4.
  - Si además 4 y 5 dan 2xx, siguen las Tasks 5 y 6.
  - Si una lectura falla, se salta su comando y en Task 7 queda documentada como "no funciona en la nube".

### Task 2: `pr commits <n>`

**Files:**
- Modify: `src/pulls.ts`, `src/pr-commands.ts` (sumar `commits` a `LISTS` y a `prLists`), `src/cli.ts` (USAGE), `src/index.ts`
- Test: `test/read.test.mjs`

**Interfaces:**
- Produces: `prCommits(repo: string, n: number): Promise<{ commits: PrCommit[]; truncated: boolean }>`, with `PrCommit = { sha: string; parents: string[]; message: string; author: { name: string; email: string; date: string }; committedAt: string }`.

- [ ] **Step 1: Test** `pr commits: sha, parents, message and dates`. Route `s.page("repos/acme/widgets/pulls/7/commits", [rawCommit])`, where `rawCommit = {sha:"a1", parents:[{sha:"p0"}], commit:{message:"feat: x", author:{name:"t",email:"t@t",date:"2026-01-01T00:00:00Z"}, committer:{date:"2026-01-02T00:00:00Z"}}}`. Expected `r.json()` to be `[{sha:"a1", parents:["p0"], message:"feat: x", author:{name:"t",email:"t@t",date:"2026-01-01T00:00:00Z"}, committedAt:"2026-01-02T00:00:00Z"}]`. Second test: `pr commits 7 extra` exits 2.
- [ ] **Step 2:** `npm test`. Expected: FAIL (`pr usage`).
- [ ] **Step 3:** Implement `prCommits` with `ghGetAll(…, 3, …)`, because GitHub returns at most 250 commits. The CLI prints `commits` and warns `TRUNCATED` if the list was cut.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: pr commits lista los commits de un PR por REST`.

### Task 3: Dueño, `projectFields` y `project fields`

**Files:**
- Create: `src/projects.ts`, `src/project-commands.ts`, `test/projects.test.mjs`
- Modify: `src/cli.ts` (group `project`, USAGE), `src/args.ts` (options `field` multiple, `value`, `issue`), `src/types.ts` (raw types `RestProjectField`, `RestProjectItem`), `src/index.ts`

**Interfaces:**
- Produces:
  - `type OwnerKind = "user" | "org"`
  - `interface ProjectRef { owner: string; number: number; kind?: OwnerKind }`
  - `projectPath(ref: ProjectRef): Promise<string>`: returns `users/{owner}/projectsV2/{n}` or `orgs/…`. Without `kind`, it reads `GET users/{owner}` and `.type === "Organization"` → org.
  - `interface ProjectField { id: number; name: string; type: string; options?: { id: string; name: string }[] }`. `type` is the raw `data_type`. `options` only for `single_select`, with `name` = `name.raw`.
  - `projectFields(ref: ProjectRef): Promise<ProjectField[]>`
  - `fieldByName(fields: ProjectField[], name: string): ProjectField`: exact match, then the only case-insensitive match. Otherwise it throws `GitHubError('project has no field "<name>"', 404)`, or `… matches several fields` when there is more than one.
  - CLI: `project <sub> <owner> <n>`. `<n>` goes through `issueNumber`.

- [ ] **Step 1: Tests**:
  - `project fields: id, name, type and options` (user, routes `GET users/acme` → `{type:"User"}` and `GET users/acme/projectsV2/3/fields`).
  - `project fields: an org owner uses orgs/` (`{type:"Organization"}`, checks the path in `s.calls()`).
  - `project fields: missing owner or number exits 2`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. The `fieldByName` test lands in Task 6, through `set`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: project fields lee los campos de un proyecto v2`.

### Task 4: Paginación por cursor, `projectItems` y `project items`

**Files:**
- Modify: `src/gh.ts`, `test/fake-gh.mjs`, `test/helpers.mjs`, `src/projects.ts`, `src/project-commands.ts`, `src/index.ts`
- Test: `test/projects.test.mjs`

**Interfaces:**
- Consumes: `projectPath`, `projectFields`, `fieldByName` (Task 3).
- Produces:
  - `ghApi(method, path, body?, opts?: { include?: boolean })`. With `include` it adds `-i` after the path, separates the headers from the body and returns `headers: Record<string, string>` with lowercase keys in `GhResult` (optional field).
  - `ghGetCursor(path: string, maxPages: number, what: string): Promise<{ items: unknown[]; truncated: boolean }>`. It asks for `per_page=100` and, while there is a `Link rel="next"`, takes its `after` (decoded) and repeats with `&after=<encodeURIComponent(cursor)>` on `path`. Same error rules as `ghGetAll`.
  - `type FieldValue = number | string | null`. Mapping: number → number; text and date → string; single_select → `name.raw`; iteration → `title`; any other type → `JSON.stringify` of the value, or null.
  - `interface ProjectItem { id: number; type: string; repo: string | null; number: number | null; state: "OPEN" | "CLOSED" | null; title: string | null; values: Record<string, FieldValue> }`. `repo` is `owner/repo`, taken from `content.repository_url`.
  - `projectItems(ref: ProjectRef, opts?: { fields?: string[] }): Promise<{ items: ProjectItem[]; truncated: boolean }>`. Without `fields` it asks for all the fields. Ceiling: 20 pages.
- Test helpers: `route(key, body, status = 200, headers = {})`. When gh gets `-i`, the fake gh prints `HTTP/2.0 <status> X\r\n<Header: v>\r\n…\r\n\r\n<body>`.

- [ ] **Step 1: Tests**:
  - `project items: values by field name, with number and state of the issue`. `--field Estimate --field Status` → path `…/items?fields[]=11&fields[]=12&per_page=100`. Expected values: `{Estimate: 3, Status: "Todo"}`.
  - `project items: follows the after cursor of Link`. Page 1 has `Link: <https://api.github.com/user/9/projectsV2/3/items?per_page=100&after=abc%3D>; rel="next"`, page 2 is at `…&after=abc%3D`. Expected: items from both pages, with neither call made to `user/9`.
  - `project items: an unknown --field exits 1 and names it`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement, then make sure the existing tests still pass with the `ghApi` change.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: project items lista los items con sus valores, paginando por cursor`.

### Task 5: `addProjectItem` y `project add` (solo si el gate de Task 1 lo permite)

**Files:** `src/projects.ts`, `src/project-commands.ts`, `src/cli.ts`, `src/index.ts`, `test/projects.test.mjs`

**Interfaces:**
- Produces: `addProjectItem(ref: ProjectRef, issue: { repo: string; number: number }): Promise<{ id: number }>`. Body `{type:"Issue", owner, repo: <name>, number}`.
- CLI: `project add <owner> <n> --issue <n> [-R owner/repo]`. The repo comes from `repoOf(flags)` and the command prints `{id}`.

- [ ] **Step 1: Tests**:
  - `project add: posts the issue of -R and prints the item id` (checks the body in `s.calls()`).
  - `project add: without --issue exits 2`.
- [ ] **Step 2–4:** fail → implement → pass (`npm test`).
- [ ] **Step 5:** Commit `feat: project add agrega una issue al proyecto`.

### Task 6: `setProjectField` y `project set` (solo si el gate de Task 1 lo permite)

**Files:** `src/projects.ts`, `src/project-commands.ts`, `src/cli.ts`, `src/index.ts`, `test/projects.test.mjs`

**Interfaces:**
- Consumes: `projectFields`, `fieldByName`, `projectItems`, `addProjectItem`.
- Produces:
  - `setProjectField(ref: ProjectRef, change: { repo: string; number: number; field: string; value: string }): Promise<{ item: number; added: boolean; field: string; value: FieldValue }>`.
  - Converting `value` to what the PATCH sends:
    - `""` → `null` (clears the field).
    - number: `Number(value)`. If it is not finite, it throws `UsageError` (`use a dot for decimals` when the value has a comma).
    - text and date: the string as it is.
    - single_select: the `id` of the option with that name (case-insensitive). If there is none, `GitHubError` listing the options.
    - anything else: `UsageError("field type <t> is not supported")`.
  - The value is checked before any write.
  - It looks up the item with `projectItems(ref, { fields: [] })` (no fields, only the content), matching `repo` and `number`. If there is no match: `addProjectItem` and `added: true`.
- CLI: `project set <owner> <n> --issue <n> --field <name> --value <v> [-R owner/repo]`, printing the result.

- [ ] **Step 1: Tests**:
  - `project set: patches the item of the issue` (body `{fields:[{id:11,value:3.5}]}`, `added:false`).
  - `project set: adds the issue when it is not in the project` (POST, then PATCH on the returned id, `added:true`).
  - `project set: matches the repo, not only the number`. The project has `other/repo#5` and `acme/widgets#5`, and it patches the second one.
  - `project set: --field estimate finds Estimate`.
  - `project set: --value 1,5 exits 2 and does not write` (no POST/PATCH in `s.calls()`).
  - `project set: --value "" sends null`.
  - `project set: single_select sends the option id`.
- [ ] **Step 2–4:** fail → implement → pass (`npm test`).
- [ ] **Step 5:** Commit `feat: project set escribe un campo de la issue en el proyecto`.

### Task 7: README, tabla de la nube y versión

**Files:** `README.md`, `package.json`, `package-lock.json`

- [ ] **Step 1:** README:
  - In "CLI", the `project …` and `pr commits` lines.
  - One bullet per new command, with its output and the caveats: archived items are not listed, only by id or through the `id` the POST returns; `set` supports number, text, date and single_select.
  - In "Library", an example with `projectItems`.
  - A section "Projects in Claude's cloud" with the probe's table from Task 1 (endpoint → works or not, plus notes on the token and archived items).
  - Any endpoint that failed in the cloud is documented, but gets no command.
- [ ] **Step 2:** `npm version 0.4.0 --no-git-tag-version`, then `npm test`. Expected: PASS.
- [ ] **Step 3:** Commit `docs: proyectos v2 por REST y resultado en la nube (0.4.0)`. Leave a comment on issue #6 linking the README section.
