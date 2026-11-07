/**
 * @file The `project` commands of the CLI: `project <sub> <owner> <n> …`.
 */
import { emit, type Flags, issueNumber, UsageError } from "./args.js";
import { type ProjectRef, projectFields, projectItems } from "./projects.js";

/** Warning when a list hit its page ceiling. */
const TRUNCATED = "the list was cut short: GitHub has more than was read.";

/** Usage of the `project` group. */
const PROJECT_USAGE =
  "project usage: fields <owner> <n> | items <owner> <n> [--field <name>...]";

/**
 * `project fields <owner> <n>` or `project items <owner> <n> [--field <name>…]`.
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
  throw new UsageError(PROJECT_USAGE);
}
