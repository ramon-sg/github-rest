// Fake gh for the tests. Answers `gh api --method M <path> [--input -]` with the routes in
// FAKE_GH_ROUTES ({"GET repos/...": {status, body}}; GraphQL goes as "POST graphql <Operation>"),
// logs every call to FAKE_GH_LOG and, if FAKE_GH_ORIGIN is a bare repo, creates there the
// branches requested over REST (POST git/refs) or through createLinkedBranch. No route: 404 like gh.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const method = args[2];
const path = args[3];
const body = args.includes("--input")
  ? JSON.parse(readFileSync(0, "utf8"))
  : undefined;
appendFileSync(
  process.env.FAKE_GH_LOG,
  `${JSON.stringify({ method, path, body })}\n`,
);
if (process.env.FAKE_GH_OFFLINE) {
  process.stderr.write("error connecting to api.github.com\n");
  process.exit(1);
}
const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const operation =
  path === "graphql"
    ? /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1]
    : undefined;
const route =
  routes[operation ? `${method} graphql ${operation}` : `${method} ${path}`];
if (route === undefined) {
  process.stdout.write('{"message":"Not Found"}');
  process.stderr.write("gh: Not Found (HTTP 404)\n");
  process.exit(1);
}
const status = route.status ?? 200;
const origin = process.env.FAKE_GH_ORIGIN;
if (status < 300 && origin && method === "POST" && path.endsWith("/git/refs")) {
  execFileSync("git", ["-C", origin, "update-ref", body.ref, body.sha]);
}
if (status < 300 && origin && operation === "CreateLinkedBranch") {
  execFileSync("git", [
    "-C",
    origin,
    "update-ref",
    `refs/heads/${body.variables.name}`,
    body.variables.oid,
  ]);
}
process.stdout.write(JSON.stringify(route.body ?? {}));
if (status >= 300) {
  process.stderr.write(
    `gh: ${route.body?.message ?? "error"} (HTTP ${status})\n`,
  );
  process.exit(1);
}
