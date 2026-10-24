/**
 * @file Labels of a repo over REST: list them and create one, or update it if it exists.
 */
import { failure, ghApi, ghGetAll } from "./gh.js";
import type { RestLabel } from "./types.js";

/** A label of the repo. */
export interface Label {
  name: string;
  color: string;
  description: string;
}

/** Pages of labels read at most (1000 labels). */
const MAX_LABEL_PAGES = 10;

/**
 * The labels of the repo.
 * @param repo - `owner/repo`.
 * @returns The labels and whether the page ceiling cut the list short.
 * @throws GitHubError if GitHub fails.
 * @example await listLabels("acme/widgets")
 */
export async function listLabels(
  repo: string,
): Promise<{ labels: Label[]; truncated: boolean }> {
  const { items, truncated } = await ghGetAll(
    `repos/${repo}/labels`,
    MAX_LABEL_PAGES,
    `the labels of ${repo}`,
  );
  return {
    labels: (items as RestLabel[]).map((raw) => ({
      name: raw.name,
      color: raw.color,
      description: raw.description ?? "",
    })),
    truncated,
  };
}

/** A label to create. */
export interface NewLabel {
  name: string;
  color?: string;
  description?: string;
  force?: boolean;
}

/**
 * Whether a 422 from GitHub means the label already exists, and not an invalid color.
 * @param data - The body of the response.
 * @returns True if it already exists.
 */
function alreadyExists(data: unknown): boolean {
  const errors = (data as { errors?: { code?: unknown }[] } | null)?.errors;
  return (
    Array.isArray(errors) &&
    errors.some((error) => error.code === "already_exists")
  );
}

/**
 * Creates a label. If it already exists, it fails, unless `force` is set: then it updates
 * its color and description, like `gh label create --force`, which makes it safe to run a
 * setup script twice.
 * @param repo - `owner/repo`.
 * @param label - Name, color (hex without `#`), description and `force`.
 * @returns Whether it was created (false if it was updated).
 * @throws GitHubError if GitHub fails or the label exists without `force`.
 * @example await createLabel("acme/widgets", { name: "size:S", color: "c5def5", force: true })
 */
export async function createLabel(
  repo: string,
  label: NewLabel,
): Promise<{ created: boolean }> {
  const fields = {
    ...(label.color === undefined ? {} : { color: label.color }),
    ...(label.description === undefined
      ? {}
      : { description: label.description }),
  };
  const res = await ghApi("POST", `repos/${repo}/labels`, {
    name: label.name,
    ...fields,
  });
  if (res.ok) return { created: true };
  if (!(res.status === 422 && alreadyExists(res.data)))
    throw failure(res, `could not create the label ${label.name}`);
  if (!label.force)
    throw failure(
      res,
      `the label ${label.name} already exists (add --force to update it)`,
    );
  const update = await ghApi(
    "PATCH",
    `repos/${repo}/labels/${encodeURIComponent(label.name)}`,
    fields,
  );
  if (!update.ok) throw failure(update, `could not update the label ${label.name}`);
  return { created: false };
}
