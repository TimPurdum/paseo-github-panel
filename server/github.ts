import { access } from "node:fs/promises";

import { z } from "zod";

import type {
  BranchInfo,
  CheckSummary,
  CommentSummary,
  IssueSummary,
  LoadCommentsRequest,
  LoadPanelRequest,
  MergePullRequestRequest,
  OpenInVSCodeRequest,
  PullRequestSummary,
  ReadyPanelPayload,
  RemoteRepository,
} from "../shared/contract";
import { GitHubPanelPayloadSchema } from "../shared/contract";
import {
  asMappedGhError,
  CommandLaunchError,
  GitHubCommandError,
  launchCommand,
  runCommand,
  runShellCommand,
  type CommandLauncher,
  type CommandRunner,
} from "./process";

const AuthorNodeSchema = z.object({ avatarUrl: z.string().nullable().optional(), login: z.string() }).nullable();
const LabelNodeSchema = z.object({ color: z.string(), name: z.string() });
const IssueNodeSchema = z.object({
  author: AuthorNodeSchema.optional(),
  bodyHTML: z.string().nullable().optional(),
  createdAt: z.string(),
  labels: z.object({ nodes: z.array(LabelNodeSchema.nullable()).nullable().optional() }).nullable().optional(),
  number: z.number().int(),
  title: z.string(),
  updatedAt: z.string(),
  url: z.string(),
});
const CheckContextSchema = z.object({
  __typename: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});
const PullRequestNodeSchema = IssueNodeSchema.extend({
  closingIssuesReferences: z.object({ nodes: z.array(IssueNodeSchema.nullable()).nullable().optional() }).nullable().optional(),
  commits: z
    .object({
      nodes: z.array(
        z
          .object({
            commit: z
              .object({
                statusCheckRollup: z
                  .object({
                    contexts: z
                      .object({ nodes: z.array(CheckContextSchema.nullable()).nullable().optional() })
                      .nullable()
                      .optional(),
                  })
                  .nullable()
                  .optional(),
              })
              .nullable()
              .optional(),
          })
          .nullable(),
      ),
    })
    .nullable()
    .optional(),
  mergeable: z.string().nullable().optional(),
  reviewDecision: z.string().nullable().optional(),
});

const GraphQlResponseSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          branchPullRequests: z.object({ nodes: z.array(PullRequestNodeSchema.nullable()) }),
          issues: z.object({ nodes: z.array(IssueNodeSchema.nullable()) }),
          pullRequests: z.object({ nodes: z.array(PullRequestNodeSchema.nullable()) }),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

const CommentNodeSchema = z.object({
  author: AuthorNodeSchema.optional(),
  bodyHTML: z.string().nullable().optional(),
  createdAt: z.string(),
  id: z.string(),
});

const CommentsResponseSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          issue: z.object({ comments: z.object({ nodes: z.array(CommentNodeSchema.nullable()) }) }).nullable().optional(),
          pullRequest: z.object({ comments: z.object({ nodes: z.array(CommentNodeSchema.nullable()) }) }).nullable().optional(),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

const GRAPHQL_QUERY = `
query GitHubPanel($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    branchPullRequests: pullRequests(states: OPEN, headRefName: $branch, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...PullRequestFields }
    }
    issues(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...IssueFields }
    }
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ...PullRequestFields }
    }
  }
}
fragment IssueFields on Issue {
  number title url bodyHTML createdAt updatedAt
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
}
fragment PullRequestFields on PullRequest {
  number title url bodyHTML createdAt updatedAt mergeable reviewDecision
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
  closingIssuesReferences(first: 1) { nodes { ...IssueFields } }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 50) {
            nodes {
              __typename
              ... on CheckRun { status conclusion }
              ... on StatusContext { state }
            }
          }
        }
      }
    }
  }
}`;

const GRAPHQL_COMMENTS_QUERY = (kind: "issue" | "pullRequest") => `
query GitHubPanelComments($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    ${kind}(number: $number) {
      comments(first: 50) { nodes { id author { login avatarUrl } bodyHTML createdAt } }
    }
  }
}`;

export interface GitHubDependencies {
  readonly launch?: CommandLauncher;
  readonly now?: () => Date;
  readonly pathExists?: (directory: string) => Promise<boolean>;
  readonly run?: CommandRunner;
  readonly runVSCode?: CommandRunner;
}

export interface TransformedGraphQlResponse {
  readonly branchPullRequest: PullRequestSummary | null;
  readonly issues: IssueSummary[];
  readonly pullRequests: PullRequestSummary[];
}

function trimGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function normalizeRemoteUrl(remoteName: string, url: string): RemoteRepository | null {
  const value = url.trim();
  if (value.length === 0) return null;

  const scpMatch = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(value);
  let host: string;
  let pathname: string;
  if (scpMatch !== null && !value.includes("://")) {
    host = (scpMatch[1] ?? "").toLowerCase();
    pathname = scpMatch[2] ?? "";
  } else {
    try {
      const parsed = new URL(value);
      host = parsed.hostname.toLowerCase();
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }

  const segments = trimGitSuffix(pathname.replace(/^\/+|\/+$/g, "")).split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments.at(-2);
  const name = segments.at(-1);
  if (owner === undefined || name === undefined) return null;
  return { host, name, owner, remoteName, url: value };
}

function sameRepository(left: RemoteRepository, right: RemoteRepository): boolean {
  return (
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  );
}

export function chooseRemote(remotes: readonly RemoteRepository[]): RemoteRepository | null {
  const origin = remotes.find((remote) => remote.remoteName === "origin");
  const upstream = remotes.find((remote) => remote.remoteName === "upstream");
  if (upstream !== undefined && origin !== undefined && !sameRepository(upstream, origin)) return upstream;
  return origin ?? upstream ?? remotes[0] ?? null;
}

function selectRemote(
  remotes: readonly RemoteRepository[],
  remoteName: string | undefined,
): RemoteRepository | null {
  if (remoteName === undefined) return chooseRemote(remotes);
  return remotes.find((remote) => remote.remoteName === remoteName) ?? null;
}

export function parseBranch(stdout: string): BranchInfo {
  const name = stdout.trim();
  return name === "HEAD" ? { kind: "detached", name: "HEAD" } : { kind: "branch", name };
}

function toIssue(node: z.infer<typeof IssueNodeSchema>): IssueSummary {
  return {
    author: node.author === null || node.author === undefined
      ? null
      : { avatarUrl: node.author.avatarUrl ?? null, login: node.author.login },
    bodyHTML: node.bodyHTML ?? "",
    createdAt: node.createdAt,
    labels: (node.labels?.nodes ?? []).filter(isPresent),
    number: node.number,
    title: node.title,
    updatedAt: node.updatedAt,
    url: node.url,
  };
}

function summarizeChecks(node: z.infer<typeof PullRequestNodeSchema>): CheckSummary {
  const commits = node.commits?.nodes ?? [];
  const latestCommit = commits.at(-1);
  const contexts = latestCommit?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  let failed = 0;
  let passed = 0;
  let pending = 0;
  for (const context of contexts) {
    if (context === null) continue;
    const state = (context.conclusion ?? context.state ?? context.status ?? "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) passed += 1;
    else if (["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "CANCELLED"].includes(state)) failed += 1;
    else pending += 1;
  }
  return { failed, passed, pending, total: failed + passed + pending };
}

function mapMergeable(value: string | null | undefined): PullRequestSummary["mergeable"] {
  if (value === "MERGEABLE") return "mergeable";
  if (value === "CONFLICTING") return "conflicting";
  return "unknown";
}

function mapReviewDecision(value: string | null | undefined): PullRequestSummary["reviewDecision"] {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes-requested";
  if (value === "REVIEW_REQUIRED") return "review-required";
  return "unknown";
}

function toPullRequest(node: z.infer<typeof PullRequestNodeSchema>): PullRequestSummary {
  const closingIssue = (node.closingIssuesReferences?.nodes ?? []).find(isPresent) ?? null;
  return {
    ...toIssue(node),
    checks: summarizeChecks(node),
    closingIssue: closingIssue === null ? null : toIssue(closingIssue),
    mergeable: mapMergeable(node.mergeable),
    reviewDecision: mapReviewDecision(node.reviewDecision),
  };
}

export function transformGraphQlResponse(value: unknown): TransformedGraphQlResponse {
  const response = GraphQlResponseSchema.parse(value);
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((error) => error.message).join("; "));
  }
  if (response.data?.repository === null || response.data?.repository === undefined) {
    throw new Error("GitHub repository was not found or is not accessible.");
  }

  const repository = response.data.repository;
  const branchPullRequest = repository.branchPullRequests.nodes.find(isPresent) ?? null;
  return {
    branchPullRequest: branchPullRequest === null ? null : toPullRequest(branchPullRequest),
    issues: repository.issues.nodes.filter(isPresent).map(toIssue),
    pullRequests: repository.pullRequests.nodes.filter(isPresent).map(toPullRequest),
  };
}

function parseRemote(line: string): RemoteRepository | null {
  const match = /^remote\.(\S+)\.url\s+(.+)$/.exec(line.trim());
  if (match === null) return null;
  return normalizeRemoteUrl(match[1] ?? "", match[2] ?? "");
}

function parseRemotes(stdout: string): RemoteRepository[] {
  return stdout.split(/\r?\n/).map(parseRemote).filter(isPresent);
}

async function defaultPathExists(directory: string): Promise<boolean> {
  try {
    await access(directory);
    return true;
  } catch {
    return false;
  }
}

function isNotGitRepositoryFailure(error: unknown): boolean {
  return (
    error instanceof GitHubCommandError &&
    error.file === "git" &&
    /not a git repository|outside repository/i.test(`${error.message}\n${error.stderr}`)
  );
}

function isNoMatchingConfigFailure(error: unknown): boolean {
  return error instanceof GitHubCommandError && error.file === "git" && error.causeCode === 1;
}

interface ResolverDependencies {
  readonly pathExists: (directory: string) => Promise<boolean>;
  readonly run: CommandRunner;
}

async function resolveGitHubRepository(
  directory: string,
  remoteName: string,
  dependencies: ResolverDependencies,
): Promise<RemoteRepository> {
  if (!(await dependencies.pathExists(directory))) {
    throw new Error(`The workspace directory no longer exists: ${directory}`);
  }

  let insideWorkTree: boolean;
  try {
    insideWorkTree =
      (await dependencies.run("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch (error) {
    if (isNotGitRepositoryFailure(error)) insideWorkTree = false;
    else throw error;
  }
  if (!insideWorkTree) throw new Error("This workspace is not a Git checkout.");

  const remotesStdout = await dependencies.run("git", ["-C", directory, "config", "--get-regexp", "^remote\\..*\\.url$"]).catch(
    (error: unknown) => {
      if (isNoMatchingConfigFailure(error)) throw new Error("This Git repository has no remotes.");
      throw new Error("Could not read Git remotes for this workspace.", { cause: error });
    },
  );

  const selectedRepository = selectRemote(parseRemotes(remotesStdout), remoteName);
  if (selectedRepository === null) {
    throw new Error(`Git remote '${remoteName}' is not available in this workspace.`);
  }
  if (selectedRepository.host !== "github.com") {
    throw new Error(`Remote ${selectedRepository.remoteName} uses ${selectedRepository.host}, not GitHub.`);
  }
  return selectedRepository;
}

export async function loadPanel(
  request: LoadPanelRequest,
  dependencies: GitHubDependencies = {},
): Promise<z.infer<typeof GitHubPanelPayloadSchema>> {
  const run = dependencies.run ?? runCommand;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  if (!(await pathExists(request.directory))) {
    return { directory: request.directory, kind: "directory-missing" };
  }

  try {
    const insideWorkTree = await run("git", ["-C", request.directory, "rev-parse", "--is-inside-work-tree"]);
    if (insideWorkTree.trim() !== "true") return { kind: "not-git" };
  } catch (error) {
    if (isNotGitRepositoryFailure(error)) return { kind: "not-git" };
    throw error;
  }

  const [branchStdout, remotesStdout] = await Promise.all([
    run("git", ["-C", request.directory, "rev-parse", "--abbrev-ref", "HEAD"]),
    run("git", ["-C", request.directory, "config", "--get-regexp", "^remote\\..*\\.url$"]).catch((error: unknown) => {
      if (isNoMatchingConfigFailure(error)) return "";
      throw error;
    }),
  ]);
  const branch = parseBranch(branchStdout);
  const repositories = parseRemotes(remotesStdout);
  if (repositories.length === 0) return { kind: "no-remote" };

  const selectedRepository = selectRemote(repositories, request.remoteName);
  if (selectedRepository === null) {
    throw new Error(`Git remote '${request.remoteName ?? ""}' is not available in this workspace.`);
  }
  if (selectedRepository.host !== "github.com") {
    return {
      branch,
      host: selectedRepository.host,
      kind: "unsupported-host",
      remoteName: selectedRepository.remoteName,
      repositories,
      selectedRepository,
    };
  }

  let transformed: TransformedGraphQlResponse;
  try {
    const output = await run("gh", [
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL_QUERY}`,
      "-F",
      `owner=${selectedRepository.owner}`,
      "-F",
      `name=${selectedRepository.name}`,
      "-F",
      `branch=${branch.name}`,
    ]);
    transformed = transformGraphQlResponse(JSON.parse(output) as unknown);
  } catch (error) {
    throw asMappedGhError(error);
  }

  const payload: ReadyPanelPayload = {
    branch,
    branchPullRequest: transformed.branchPullRequest,
    fetchedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    issues: transformed.issues,
    kind: "ready",
    pullRequests: transformed.pullRequests,
    repositories,
    selectedRepository,
  };
  return GitHubPanelPayloadSchema.parse(payload);
}

export async function mergePullRequest(
  request: MergePullRequestRequest,
  dependencies: GitHubDependencies = {},
): Promise<{ merged: true }> {
  const run = dependencies.run ?? runCommand;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  const selectedRepository = await resolveGitHubRepository(request.directory, request.remoteName, {
    pathExists,
    run,
  });

  try {
    await run("gh", [
      "pr",
      "merge",
      String(request.number),
      "--repo",
      `${selectedRepository.owner}/${selectedRepository.name}`,
      "--merge",
    ]);
  } catch (error) {
    throw asMappedGhError(error);
  }
  return { merged: true };
}

const VSCODE_COMMAND = "code";
const VSCODE_FOCUS_EXTENSION = "dymaptic.paseo-github-focus";
const VSCODE_FOCUS_URI = "vscode://dymaptic.paseo-github-focus/focus";

function isMissingEditorFailure(error: unknown): boolean {
  if (!(error instanceof CommandLaunchError)) return false;
  return error.causeCode === "ENOENT" || /not recognized|command not found/i.test(error.message);
}

async function isFocusHelperInstalled(runVSCode: CommandRunner): Promise<boolean> {
  try {
    const output = await runVSCode(VSCODE_COMMAND, ["--list-extensions"]);
    return output
      .split(/\r?\n/)
      .some((line) => line.trim().toLowerCase() === VSCODE_FOCUS_EXTENSION.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Opens the workspace in VS Code on the daemon host, then focuses the GitHub
 * Pull Requests view. VS Code has no command-line switch for a contributed view,
 * so the focus goes through the companion `paseo-github-focus` extension's URI
 * when it is installed; without it the workspace still opens.
 */
export async function openInVSCode(
  request: OpenInVSCodeRequest,
  dependencies: GitHubDependencies = {},
): Promise<{ opened: true }> {
  const launch = dependencies.launch ?? launchCommand;
  const runVSCode = dependencies.runVSCode ?? runShellCommand;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  if (!(await pathExists(request.directory))) {
    throw new Error(`The workspace directory no longer exists: ${request.directory}`);
  }

  try {
    await launch(VSCODE_COMMAND, ["--reuse-window", request.directory]);
  } catch (error) {
    if (isMissingEditorFailure(error)) {
      throw new Error(
        "VS Code CLI (code) was not found on the Paseo daemon host. Install it there (Shell Command: Install 'code' command in PATH) and reload the plugin.",
        { cause: error },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not open VS Code on the Paseo daemon host: ${detail}`, { cause: error });
  }

  if (await isFocusHelperInstalled(runVSCode)) {
    try {
      await launch(VSCODE_COMMAND, ["--open-url", VSCODE_FOCUS_URI]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `VS Code opened, but focusing the GitHub view failed: ${detail}. Reinstall the ${VSCODE_FOCUS_EXTENSION} extension on the daemon host.`,
        { cause: error },
      );
    }
  }
  return { opened: true };
}

function toComment(node: z.infer<typeof CommentNodeSchema>): CommentSummary {
  return {
    author: node.author === null || node.author === undefined
      ? null
      : { avatarUrl: node.author.avatarUrl ?? null, login: node.author.login },
    bodyHTML: node.bodyHTML ?? "",
    createdAt: node.createdAt,
    id: node.id,
  };
}

export function extractComments(value: unknown, kind: "issue" | "pullRequest"): CommentSummary[] {
  const response = CommentsResponseSchema.parse(value);
  const repository = response.data?.repository;
  const source =
    repository === null || repository === undefined
      ? undefined
      : kind === "issue"
        ? repository.issue
        : repository.pullRequest;
  if (source !== null && source !== undefined) {
    return source.comments.nodes.filter(isPresent).map(toComment);
  }
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((error) => error.message).join("; "));
  }
  if (repository === null || repository === undefined) {
    throw new Error("GitHub repository was not found or is not accessible.");
  }
  throw new Error("GitHub item was not found or is not accessible.");
}

export async function loadComments(
  request: LoadCommentsRequest,
  dependencies: GitHubDependencies = {},
): Promise<{ comments: CommentSummary[] }> {
  const run = dependencies.run ?? runCommand;
  const pathExists = dependencies.pathExists ?? defaultPathExists;
  const selectedRepository = await resolveGitHubRepository(request.directory, request.remoteName, {
    pathExists,
    run,
  });

  let output: string;
  try {
    output = await run("gh", [
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL_COMMENTS_QUERY(request.kind)}`,
      "-F",
      `owner=${selectedRepository.owner}`,
      "-F",
      `name=${selectedRepository.name}`,
      "-F",
      `number=${request.number}`,
    ]);
  } catch (error) {
    // gh exits non-zero when the response carries a GraphQL errors array even
    // though stdout holds the payload; salvage it before mapping a failure.
    if (error instanceof GitHubCommandError && error.stdout.trim().length > 0) {
      output = error.stdout;
    } else {
      throw asMappedGhError(error);
    }
  }
  return { comments: extractComments(JSON.parse(output) as unknown, request.kind) };
}
