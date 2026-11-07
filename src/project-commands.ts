/**
 * @file The `project` commands of the CLI: `project <sub> <owner> <n> …`.
 */
import { emit, type Flags, issueNumber, repoOf, UsageError } from "./args.js";
import {
  addProjectItem,
  type ProjectRef,
  projectFields,
  projectItems,
} from "./projects.js";

/** Warning when a list hit its page ceiling. */
const TRUNCATED = "the list was cut short: GitHub has more than was read.";

/** Usage of the `project` group. */
const PROJECT_USAGE =
  "project usage: fields <owner> <n> | items <owner> <n> [--field <name>...] | add <owner> <n> --issue <n> [-R owner/repo]";

/**
 * `project fields|items|add <owner> <n> …`.
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
  throw new UsageError(PROJECT_USAGE);
}
