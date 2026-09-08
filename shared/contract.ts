import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const AuthorSchema = z.object({
  avatarUrl: z.string().url().nullable(),
  login: z.string(),
});

export const LabelSchema = z.object({
  color: z.string(),
  name: z.string(),
});

export const IssueSummarySchema = z.object({
  author: AuthorSchema.nullable(),
  bodyHTML: z.string(),
  createdAt: z.string(),
  labels: z.array(LabelSchema),
  number: z.number().int().positive(),
  title: z.string(),
  updatedAt: z.string(),
  url: z.string().url(),
});

export const CheckSummarySchema = z.object({
  failed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const PullRequestSummarySchema = IssueSummarySchema.extend({
  checks: CheckSummarySchema,
  closingIssue: IssueSummarySchema.nullable(),
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  reviewDecision: z.enum(["approved", "changes-requested", "review-required", "unknown"]),
});

export const RemoteRepositorySchema = z.object({
  host: z.string(),
  name: z.string(),
  owner: z.string(),
  remoteName: z.string(),
  url: z.string(),
});

export const BranchInfoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), name: z.string() }),
  z.object({ kind: z.literal("detached"), name: z.literal("HEAD") }),
]);

export const ReadyPanelPayloadSchema = z.object({
  branch: BranchInfoSchema,
  branchPullRequest: PullRequestSummarySchema.nullable(),
  fetchedAt: z.string(),
  issues: z.array(IssueSummarySchema),
  kind: z.literal("ready"),
  pullRequests: z.array(PullRequestSummarySchema),
  repositories: z.array(RemoteRepositorySchema),
  selectedRepository: RemoteRepositorySchema,
});

export const GitHubPanelPayloadSchema = z.discriminatedUnion("kind", [
  ReadyPanelPayloadSchema,
  z.object({ directory: z.string(), kind: z.literal("directory-missing") }),
  z.object({ kind: z.literal("not-git") }),
  z.object({ kind: z.literal("no-remote") }),
  z.object({
    branch: BranchInfoSchema,
    host: z.string(),
    kind: z.literal("unsupported-host"),
    remoteName: z.string(),
    repositories: z.array(RemoteRepositorySchema),
    selectedRepository: RemoteRepositorySchema,
  }),
]);

export const LoadPanelRequestSchema = z.object({
  directory: z.string().min(1),
  remoteName: z.string().min(1).optional(),
});

export const LoadImageRequestSchema = z.object({ url: z.string().url() });
export const LoadImageResponseSchema = z.object({
  base64: z.string(),
  mimeType: z.string(),
});

export const loadPanelRpc = defineRpc({
  input: LoadPanelRequestSchema,
  name: "github.load-panel",
  output: GitHubPanelPayloadSchema,
});

export const loadImageRpc = defineRpc({
  input: LoadImageRequestSchema,
  name: "github.load-image",
  output: LoadImageResponseSchema,
});

export type Author = z.infer<typeof AuthorSchema>;
export type BranchInfo = z.infer<typeof BranchInfoSchema>;
export type CheckSummary = z.infer<typeof CheckSummarySchema>;
export type GitHubPanelPayload = z.infer<typeof GitHubPanelPayloadSchema>;
export type IssueSummary = z.infer<typeof IssueSummarySchema>;
export type Label = z.infer<typeof LabelSchema>;
export type LoadImageRequest = z.infer<typeof LoadImageRequestSchema>;
export type LoadImageResponse = z.infer<typeof LoadImageResponseSchema>;
export type LoadPanelRequest = z.infer<typeof LoadPanelRequestSchema>;
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;
export type ReadyPanelPayload = z.infer<typeof ReadyPanelPayloadSchema>;
export type RemoteRepository = z.infer<typeof RemoteRepositorySchema>;
