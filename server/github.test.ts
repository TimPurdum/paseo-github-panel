import { describe, expect, it, vi } from "vitest";

import graphQlFixture from "./fixtures/panel-graphql.json";

import {
  chooseRemote,
  loadPanel,
  normalizeRemoteUrl,
  parseBranch,
  transformGraphQlResponse,
} from "./github";
import { GitHubCommandError } from "./process";

describe("normalizeRemoteUrl", () => {
  it.each([
    ["git@github.com:dymaptic/GeoBlazor.git", "dymaptic", "GeoBlazor"],
    ["ssh://git@github.com/dymaptic/GeoBlazor.git", "dymaptic", "GeoBlazor"],
    ["https://github.com/dymaptic/GeoBlazor.git", "dymaptic", "GeoBlazor"],
  ])("normalizes GitHub remote %s", (url, owner, name) => {
    expect(normalizeRemoteUrl("origin", url)).toMatchObject({ host: "github.com", name, owner });
  });

  it("preserves a non-GitHub host for a typed unsupported-host state", () => {
    expect(normalizeRemoteUrl("origin", "https://dev.azure.com/acme/project/_git/repo")?.host).toBe(
      "dev.azure.com",
    );
  });
});

describe("chooseRemote", () => {
  const origin = normalizeRemoteUrl("origin", "git@github.com:fork/repo.git");
  const upstream = normalizeRemoteUrl("upstream", "git@github.com:parent/repo.git");

  it("prefers an upstream that differs from origin", () => {
    expect(chooseRemote([origin, upstream].filter((remote) => remote !== null))).toEqual(upstream);
  });

  it("uses origin when it is the only remote", () => {
    expect(chooseRemote([origin].filter((remote) => remote !== null))).toEqual(origin);
  });
});

describe("parseBranch", () => {
  it("returns a named branch", () => {
    expect(parseBranch("feature/github-panel\n")).toEqual({ kind: "branch", name: "feature/github-panel" });
  });

  it("returns the detached-head state", () => {
    expect(parseBranch("HEAD\n")).toEqual({ kind: "detached", name: "HEAD" });
  });
});

describe("loadPanel", () => {
  it("uses one gh GraphQL request for all panel data", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git" && args.includes("--get-regexp")) {
        return "remote.origin.url git@github.com:owner/repo.git\n";
      }
      if (file === "git" && args.includes("rev-parse")) return "main\n";
      return JSON.stringify({ data: { repository: { branchPullRequests: { nodes: [] }, issues: { nodes: [] }, pullRequests: { nodes: [] } } } });
    });

    const result = await loadPanel(
      { directory: "C:\\repo" },
      { run, now: () => new Date("2026-09-08T12:00:00Z"), pathExists: async () => true },
    );

    expect(result.kind).toBe("ready");
    expect(run.mock.calls.filter(([file]) => file === "gh")).toHaveLength(1);
  });

  it("returns a normal directory-missing state without running a command", async () => {
    const run = vi.fn();
    await expect(loadPanel({ directory: "C:\\gone" }, { pathExists: async () => false, run })).resolves.toEqual({
      directory: "C:\\gone",
      kind: "directory-missing",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns a normal no-remote state", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes("--is-inside-work-tree")) return "true\n";
      if (args.includes("--get-regexp")) return "";
      return "HEAD\n";
    });
    await expect(loadPanel({ directory: "C:\\repo" }, { pathExists: async () => true, run })).resolves.toEqual({
      kind: "no-remote",
    });
  });

  it("honors an explicitly selected remote", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git" && args.includes("--get-regexp")) {
        return "remote.origin.url git@github.com:fork/repo.git\nremote.upstream.url git@github.com:parent/repo.git\n";
      }
      if (file === "git") return "main\n";
      return JSON.stringify({ data: { repository: { branchPullRequests: { nodes: [] }, issues: { nodes: [] }, pullRequests: { nodes: [] } } } });
    });
    const result = await loadPanel(
      { directory: "C:\\repo", remoteName: "origin" },
      { pathExists: async () => true, run },
    );

    expect(result.kind === "ready" ? result.selectedRepository.owner : null).toBe("fork");
  });

  it("does not hide a missing git executable as a not-git state", async () => {
    const run = vi.fn(async () => {
      throw new GitHubCommandError("git", [], "", "", "ENOENT");
    });

    await expect(loadPanel({ directory: "C:\\repo" }, { pathExists: async () => true, run })).rejects.toMatchObject({
      causeCode: "ENOENT",
    });
  });

  it("does not hide an operational git-config failure as a no-remote state", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes("--is-inside-work-tree")) return "true\n";
      if (args.includes("--get-regexp")) {
        throw new GitHubCommandError("git", args, "", "config is unreadable", 128);
      }
      return "main\n";
    });

    await expect(loadPanel({ directory: "C:\\repo" }, { pathExists: async () => true, run })).rejects.toMatchObject({
      causeCode: 128,
    });
  });

  it("keeps remote names that contain periods selectable", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git" && args.includes("--get-regexp")) {
        return "remote.company.fork.url git@github.com:fork/repo.git\n";
      }
      if (file === "git") return "main\n";
      return JSON.stringify({ data: { repository: { branchPullRequests: { nodes: [] }, issues: { nodes: [] }, pullRequests: { nodes: [] } } } });
    });

    const result = await loadPanel(
      { directory: "C:\\repo", remoteName: "company.fork" },
      { pathExists: async () => true, run },
    );
    expect(result.kind === "ready" ? result.selectedRepository.remoteName : null).toBe("company.fork");
  });
});

describe("transformGraphQlResponse", () => {
  it("maps a captured GraphQL fixture to panel summaries", () => {
    const result = transformGraphQlResponse(graphQlFixture);

    expect(result.branchPullRequest?.number).toBe(42);
    expect(result.issues[0]?.labels[0]?.name).toBe("bug");
  });

  it("surfaces an error-only GraphQL response without a schema-validation dump", () => {
    expect(() => transformGraphQlResponse({ errors: [{ message: "API rate limit exceeded" }] })).toThrow(
      "API rate limit exceeded",
    );
  });
});
