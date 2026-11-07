/**
 * @file Projects v2 over REST: the fields of a project, its items with their values, adding
 * an issue and writing a field. The owner can be a user or an organization.
 */
import { failure, GitHubError, ghApi } from "./gh.js";
import type { RestProjectField } from "./types.js";

/** Who owns a project. */
export type OwnerKind = "user" | "org";

/** A project: its owner's login and its number. Without `kind`, the owner is looked up. */
export interface ProjectRef {
  owner: string;
  number: number;
  kind?: OwnerKind;
}

/** A field of a project. `options` only for single_select fields. */
export interface ProjectField {
  id: number;
  name: string;
  type: string;
  options?: { id: string; name: string }[];
}

/**
 * The REST path of a project: `users/{owner}/projectsV2/{n}` or `orgs/…`.
 * @param ref - The project.
 * @returns The path, without a leading `/`.
 * @throws GitHubError if the owner cannot be read.
 * @example await projectPath({ owner: "acme", number: 3 }) // "orgs/acme/projectsV2/3"
 */
export async function projectPath(ref: ProjectRef): Promise<string> {
  let kind = ref.kind;
  if (kind === undefined) {
    const res = await ghApi("GET", `users/${ref.owner}`);
    if (!res.ok) throw failure(res, `could not read the account ${ref.owner}`);
    kind =
      (res.data as { type?: string } | null)?.type === "Organization"
        ? "org"
        : "user";
  }
  return `${kind === "org" ? "orgs" : "users"}/${ref.owner}/projectsV2/${ref.number}`;
}

/**
 * The fields of a project at a known path.
 * @param path - From `projectPath`.
 * @param what - The project, for the error.
 * @returns The fields.
 * @throws GitHubError if GitHub fails.
 */
async function fieldsAt(path: string, what: string): Promise<ProjectField[]> {
  const res = await ghApi("GET", `${path}/fields?per_page=100`);
  if (!res.ok || !Array.isArray(res.data))
    throw failure(res, `could not read the fields of ${what}`);
  return (res.data as RestProjectField[]).map((raw) => ({
    id: raw.id,
    name: raw.name,
    type: raw.data_type,
    ...(raw.data_type === "single_select"
      ? {
          options: (raw.options ?? []).map((option) => ({
            id: option.id,
            name: option.name.raw,
          })),
        }
      : {}),
  }));
}

/**
 * How a project is named in messages: `owner/n`.
 * @param ref - The project.
 * @returns The name.
 */
export const projectName = (ref: ProjectRef): string =>
  `project ${ref.owner}/${ref.number}`;

/**
 * The fields of a project.
 * @param ref - The project.
 * @returns The fields, in the project's order.
 * @throws GitHubError if GitHub fails.
 * @example await projectFields({ owner: "acme", number: 3 })
 */
export async function projectFields(ref: ProjectRef): Promise<ProjectField[]> {
  return fieldsAt(await projectPath(ref), projectName(ref));
}

/**
 * A field by name: the exact name, or else the only one that matches ignoring case.
 * @param fields - The project's fields.
 * @param name - The name asked for.
 * @returns The field.
 * @throws GitHubError (404) if no field matches, or if several match ignoring case.
 * @example fieldByName(fields, "estimate").name // "Estimate"
 */
export function fieldByName(fields: ProjectField[], name: string): ProjectField {
  const exact = fields.find((field) => field.name === name);
  if (exact !== undefined) return exact;
  const lower = name.toLowerCase();
  const loose = fields.filter((field) => field.name.toLowerCase() === lower);
  if (loose.length === 1) return loose[0] as ProjectField;
  if (loose.length > 1)
    throw new GitHubError(
      `"${name}" matches several fields: ${loose.map((field) => field.name).join(", ")}`,
      404,
    );
  throw new GitHubError(`the project has no field "${name}"`, 404);
}
