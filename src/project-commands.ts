/**
 * @file The `project` commands of the CLI: `project <sub> <owner> <n> …`.
 */
import { emit, type Flags, issueNumber, UsageError } from "./args.js";
import { type ProjectRef, projectFields } from "./projects.js";

/** Usage of the `project` group. */
const PROJECT_USAGE = "project usage: fields <owner> <n>";

/**
 * `project fields <owner> <n>`.
 * @param _flags - Options.
 * @param args - Positionals after `project`.
 * @throws UsageError or GitHubError.
 */
export async function projectCommand(
  _flags: Flags,
  args: string[],
): Promise<void> {
  const [sub, owner, n, ...extra] = args;
  if (owner === undefined || extra.length > 0) throw new UsageError(PROJECT_USAGE);
  const ref: ProjectRef = { owner, number: issueNumber(n) };
  if (sub === "fields") return emit(await projectFields(ref));
  throw new UsageError(PROJECT_USAGE);
}
