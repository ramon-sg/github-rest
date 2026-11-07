/**
 * @file Projects v2 over REST: the fields of a project, its items with their values, adding
 * an issue and writing a field. The owner can be a user or an organization.
 */
import { failure, GitHubError, ghApi, ghGetCursor } from "./gh.js";
import { sameRepo, splitRepo } from "./repo.js";
import type {
  RestProjectField,
  RestProjectFieldValue,
  RestProjectItem,
} from "./types.js";

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

/** The value of a field of an item, readable: a number, a text, or null if it is empty. */
export type FieldValue = number | string | null;

/** An item of a project: an issue, a PR or a draft, with the values asked for. */
export interface ProjectItem {
  id: number;
  type: string;
  repo: string | null;
  number: number | null;
  state: "OPEN" | "CLOSED" | null;
  title: string | null;
  values: Record<string, FieldValue>;
}

/** Pages of items read at most (2000 items). */
const MAX_ITEM_PAGES = 20;

/**
 * A readable text for an object of a field value: its `raw`, `title`, `full_name`, `login` or
 * `name`, or `#n` for an issue or PR.
 * @param value - The object.
 * @returns The text, or JSON if it has none of those.
 */
function labelOf(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const o = value as Record<string, unknown>;
  for (const key of ["raw", "title", "full_name", "login", "name"]) {
    const v = o[key];
    if (typeof v === "string") return v;
    if (typeof v === "object" && v !== null && typeof (v as { raw?: unknown }).raw === "string")
      return (v as { raw: string }).raw;
  }
  if (typeof o.number === "number") return `#${o.number}`;
  return JSON.stringify(value);
}

/**
 * The readable value of a field: numbers stay numbers, single_select gives the option name,
 * iteration its title, lists (assignees, labels) the names joined with commas.
 * @param field - The field value of the item.
 * @returns The value.
 */
function readValue(field: RestProjectFieldValue): FieldValue {
  const { value } = field;
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value))
    return value.length === 0 ? null : value.map(labelOf).join(", ");
  return labelOf(value);
}

/** `owner/repo` from a REST `repository_url`. */
const REPO_URL = /\/repos\/([^/]+\/[^/]+)$/;

/**
 * An item with what the package uses.
 * @param raw - The REST item.
 * @returns The item.
 */
function toItem(raw: RestProjectItem): ProjectItem {
  const content = raw.content ?? null;
  const values: Record<string, FieldValue> = {};
  for (const field of raw.fields ?? []) values[field.name] = readValue(field);
  return {
    id: raw.id,
    type: raw.content_type,
    repo: REPO_URL.exec(content?.repository_url ?? "")?.[1] ?? null,
    number: content?.number ?? null,
    state:
      content?.state === undefined
        ? null
        : content.state === "open"
          ? "OPEN"
          : "CLOSED",
    title: content?.title ?? null,
    values,
  };
}

/**
 * The items of a project, with the values of the fields asked for. Archived items are not
 * listed: GitHub's REST list leaves them out.
 * @param ref - The project.
 * @param opts - `fields`: names of the fields to read; all of them if absent, none if empty.
 * @returns The items and whether the page ceiling cut the list short.
 * @throws GitHubError if GitHub fails or a field does not exist.
 * @example await projectItems({ owner: "acme", number: 3 }, { fields: ["Estimate"] })
 */
export async function projectItems(
  ref: ProjectRef,
  opts: { fields?: string[] } = {},
): Promise<{ items: ProjectItem[]; truncated: boolean }> {
  return itemsAt(await projectPath(ref), ref, opts.fields);
}

/**
 * The items of a project at a known path.
 * @param path - From `projectPath`.
 * @param ref - The project, for messages.
 * @param names - Fields to read: all if undefined, none if empty.
 * @returns The items and whether the list was cut short.
 * @throws GitHubError if GitHub fails or a field does not exist.
 */
async function itemsAt(
  path: string,
  ref: ProjectRef,
  names: string[] | undefined,
): Promise<{ items: ProjectItem[]; truncated: boolean }> {
  let ids: number[] = [];
  if (names === undefined || names.length > 0) {
    const fields = await fieldsAt(path, projectName(ref));
    ids =
      names === undefined
        ? fields.map((field) => field.id)
        : names.map((name) => fieldByName(fields, name).id);
  }
  const query = ids.map((id) => `fields[]=${id}`).join("&");
  const { items, truncated } = await ghGetCursor(
    query === "" ? `${path}/items` : `${path}/items?${query}`,
    MAX_ITEM_PAGES,
    `the items of ${projectName(ref)}`,
  );
  return { items: (items as RestProjectItem[]).map(toItem), truncated };
}

/** An issue of a repo. */
export interface IssueRef {
  repo: string;
  number: number;
}

/**
 * The item of an issue among the listed (not archived) items of a project.
 * @param path - From `projectPath`.
 * @param ref - The project, for messages.
 * @param issue - The issue.
 * @returns The item, or undefined if the list does not have it.
 * @throws GitHubError if GitHub fails.
 */
async function findItem(
  path: string,
  ref: ProjectRef,
  issue: IssueRef,
): Promise<ProjectItem | undefined> {
  const { items } = await itemsAt(path, ref, []);
  return items.find(
    (item) =>
      item.number === issue.number &&
      item.repo !== null &&
      sameRepo(item.repo, issue.repo),
  );
}

/**
 * Whether a 422 from GitHub means the issue is already in the project.
 * @param data - The body of the response.
 * @returns True if it already is.
 */
const alreadyThere = (data: unknown): boolean =>
  /already exists/i.test(String((data as { message?: unknown } | null)?.message ?? ""));

/**
 * Adds an issue to a project. If it is already there, it gives its item; GitHub answers 422
 * then, without the id, so the item is looked up in the list.
 * @param ref - The project.
 * @param issue - The issue: `owner/repo` and number.
 * @returns The item id and whether it was added now.
 * @throws GitHubError if GitHub fails, or (422) if the issue is in the project but not in its
 *   list: archived items are not listed and cannot be written, and the list lags a few
 *   seconds behind an add.
 * @example await addProjectItem({ owner: "acme", number: 3 }, { repo: "acme/widgets", number: 7 })
 */
export async function addProjectItem(
  ref: ProjectRef,
  issue: IssueRef,
): Promise<{ id: number; added: boolean }> {
  const path = await projectPath(ref);
  const { owner, name } = splitRepo(issue.repo);
  const res = await ghApi("POST", `${path}/items`, {
    type: "Issue",
    owner,
    repo: name,
    number: issue.number,
  });
  const what = `issue ${issue.repo}#${issue.number}`;
  if (res.ok) return { id: (res.data as { id: number }).id, added: true };
  if (!(res.status === 422 && alreadyThere(res.data)))
    throw failure(res, `could not add ${what} to ${projectName(ref)}`);
  const found = await findItem(path, ref, issue);
  if (found === undefined)
    throw new GitHubError(
      `${what} is already in ${projectName(ref)} but not in its item list: it is archived (unarchive it first) or was added seconds ago (try again)`,
      422,
    );
  return { id: found.id, added: false };
}
