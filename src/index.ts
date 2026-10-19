/**
 * @file Library entry point: what an issue workflow uses from GitHub, over REST only.
 */
export { GitHubError } from "./gh.js";
export { assign, type IssueView, viewIssue } from "./issues.js";
export type { Local } from "./local.js";
export {
  createPr,
  findPr,
  getPr,
  type NewPr,
  type Pr,
  type PrChange,
  type PrState,
  updatePr,
} from "./pulls.js";
export { type StartResult, startBranch } from "./start.js";
export {
  type IssueEntry,
  type IssueWork,
  readWork,
  type WorkBranch,
  type WorkOutput,
  type WorkPr,
} from "./work.js";
