/**
 * @file The `project` commands of the CLI: `project <sub> <owner> <n> …`.
 */
import { emit, type Flags, issueNumber, repoOf, UsageError } from "./args.js";
import {
  addProjectItem,
  InvalidFieldValueError,
  type ProjectRef,
  projectFields,
  projectItems,
  setProjectField,
} from "./projects.js";

/** Warning when a list hit its page ceiling. */
const TRUNCATED = "the list was cut short: GitHub has more than was read.";

/** Usage of the `project` group. */
const PROJECT_USAGE =
  "project usage: fields <owner> <n> | items <owner> <n> [--field <name>...] | add <owner> <n> --issue <n> [-R owner/repo] | set <owner> <n> --issue <n> --field <name> --value <v> [-R owner/repo]";

/**
 * `project set <owner> <n> --issue <n> --field <name> --value <v>`.
 * @param flags - Options.
 * @param ref - The project.
 * @throws UsageError or GitHubError.
 */
async function projectSet(flags: Flags, ref: ProjectRef): Promise<void> {
  const field = flags.field?.[0];
  if (
    flags.issue === undefined ||
    field === undefined ||
    flags.field?.length !== 1 ||
    flags.value === undefined
  )
    throw new UsageError(
      "project set needs --issue <n>, one --field <name> and --value <v>.",
    );
  const number = issueNumber(flags.issue);
  try {
    emit(
      await setProjectField(ref, {
        repo: repoOf(flags),
        number,
        field,
        value: flags.value,
      }),
    );
  } catch (error) {
    if (error instanceof InvalidFieldValueError)
      throw new UsageError(error.message);
    throw error;
  }
}

/**
 * `project fields|items|add|set <owner> <n> …`.
 * @param flags - Options.
 * @param args - Positionals after `project`.
 * @throws UsageError or GitHubError.
 */
export async function projectCommand(
  flags: Flags,
  args: string[],
): Promise<void> {
  const [sub, owner, n, ...extra] = args;
  if (owner === undefined || extra.length > 0) throw new UsageError(PROJECT_USAGE);
  const ref: ProjectRef = { owner, number: issueNumber(n) };
  if (sub === "fields") return emit(await projectFields(ref));
  if (sub === "items") {
    const { items, truncated } = await projectItems(
      ref,
      flags.field === undefined ? {} : { fields: flags.field },
    );
    return emit(items, truncated ? [TRUNCATED] : []);
  }
  if (sub === "add") {
    if (flags.issue === undefined) throw new UsageError("project add needs --issue <n>.");
    const number = issueNumber(flags.issue);
    return emit(await addProjectItem(ref, { repo: repoOf(flags), number }));
  }
  if (sub === "set") return projectSet(flags, ref);
  throw new UsageError(PROJECT_USAGE);
}
