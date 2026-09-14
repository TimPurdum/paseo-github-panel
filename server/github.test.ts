import { describe, expect, it, vi } from "vitest";

import graphQlFixture from "./fixtures/panel-graphql.json";

import {
  chooseRemote,
  loadComments,
  loadPanel,
  mergePullRequest,
  normalizeRemoteUrl,
  openInVSCode,
  parseBranch,
  transformGraphQlResponse,
} from "./github";
import { CommandLaunchError, GitHubCommandError } from "./process";

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

describe("mergePullRequest", () => {
  it("merges through gh against the selected repository with a merge commit", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      return "";
    });

    await expect(
      mergePullRequest(
        { directory: "C:\\repo", number: 42, remoteName: "origin" },
        { pathExists: async () => true, run },
      ),
    ).resolves.toEqual({ merged: true });
    expect(run).toHaveBeenCalledWith("gh", ["pr", "merge", "42", "--repo", "owner/repo", "--merge"]);
  });

  it("refuses to merge against a non-GitHub host", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes("--is-inside-work-tree")) return "true\n";
      return "remote.origin.url https://dev.azure.com/acme/project/_git/repo\n";
    });

    await expect(
      mergePullRequest(
        { directory: "C:\\repo", number: 42, remoteName: "origin" },
        { pathExists: async () => true, run },
      ),
    ).rejects.toThrow("not GitHub");
    expect(run.mock.calls.filter(([file]) => file === "gh")).toHaveLength(0);
  });

  it("reports a selected remote that no longer exists", async () => {
    const run = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args.includes("--is-inside-work-tree")) return "true\n";
      return "remote.origin.url git@github.com:owner/repo.git\n";
    });

    await expect(
      mergePullRequest(
        { directory: "C:\\repo", number: 42, remoteName: "missing" },
        { pathExists: async () => true, run },
      ),
    ).rejects.toThrow("not available");
  });

  it("reports a missing directory without running commands", async () => {
    const run = vi.fn();

    await expect(
      mergePullRequest(
        { directory: "C:\\gone", number: 42, remoteName: "origin" },
        { pathExists: async () => false, run },
      ),
    ).rejects.toThrow("no longer exists");
    expect(run).not.toHaveBeenCalled();
  });

  it("maps a refused merge to a friendly message", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      throw new GitHubCommandError(
        "gh",
        ["pr", "merge"],
        "",
        "Pull request 42 is not mergeable: the base branch policy prohibits merging.",
        1,
      );
    });

    await expect(
      mergePullRequest(
        { directory: "C:\\repo", number: 42, remoteName: "origin" },
        { pathExists: async () => true, run },
      ),
    ).rejects.toThrow("cannot merge this pull request");
  });
});

describe("openInVSCode", () => {
  const noExtensions = async (): Promise<string> => "GitHub.vscode-pull-request-github\n";
  const withHelper = async (): Promise<string> => "GitHub.vscode-pull-request-github\ndymaptic.paseo-github-focus\n";

  it("opens the workspace folder in VS Code, reusing an existing window", async () => {
    const launch = vi.fn(async () => undefined);

    await expect(
      openInVSCode(
        { directory: "C:\\repo" },
        { launch, pathExists: async () => true, runVSCode: noExtensions },
      ),
    ).resolves.toEqual({ opened: true });
    expect(launch).toHaveBeenCalledWith("code", ["--reuse-window", "C:\\repo"]);
  });

  it("focuses the GitHub view through the helper extension when it is installed", async () => {
    const launch = vi.fn(async () => undefined);

    await openInVSCode(
      { directory: "C:\\repo" },
      { launch, pathExists: async () => true, runVSCode: withHelper },
    );

    expect(launch).toHaveBeenNthCalledWith(1, "code", ["--reuse-window", "C:\\repo"]);
    expect(launch).toHaveBeenNthCalledWith(2, "code", [
      "--open-url",
      "vscode://dymaptic.paseo-github-focus/focus",
    ]);
  });

  it("does not fire the focus URI when the helper extension is absent", async () => {
    const launch = vi.fn(async () => undefined);

    await openInVSCode(
      { directory: "C:\\repo" },
      { launch, pathExists: async () => true, runVSCode: noExtensions },
    );

    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("reports a missing directory without launching VS Code", async () => {
    const launch = vi.fn(async () => undefined);
    const runVSCode = vi.fn(noExtensions);

    await expect(
      openInVSCode({ directory: "C:\\gone" }, { launch, pathExists: async () => false, runVSCode }),
    ).rejects.toThrow("no longer exists");
    expect(launch).not.toHaveBeenCalled();
    expect(runVSCode).not.toHaveBeenCalled();
  });

  it("maps a missing code executable to a daemon-host installation message", async () => {
    const launch = vi.fn(async () => {
      throw new CommandLaunchError("code", [], "ENOENT", "spawn code ENOENT");
    });

    await expect(
      openInVSCode(
        { directory: "C:\\repo" },
        { launch, pathExists: async () => true, runVSCode: noExtensions },
      ),
    ).rejects.toThrow(/code.*not found on the Paseo daemon host/i);
  });

  it("maps a Windows command-processor miss to the same installation message", async () => {
    const launch = vi.fn(async () => {
      throw new CommandLaunchError(
        "code",
        [],
        1,
        "'code' is not recognized as an internal or external command",
      );
    });

    await expect(
      openInVSCode(
        { directory: "C:\\repo" },
        { launch, pathExists: async () => true, runVSCode: noExtensions },
      ),
    ).rejects.toThrow(/not found on the Paseo daemon host/i);
  });
});

describe("loadComments", () => {
  it("loads the conversation for an issue through one gh request", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      return JSON.stringify({
        data: {
          repository: {
            issue: {
              comments: {
                nodes: [
                  { id: "c1", author: { login: "tim" }, bodyHTML: "<p>Looks good</p>", createdAt: "2026-09-01T10:00:00Z" },
                  { id: "c2", author: null, bodyHTML: "<p>Deleted user text</p>", createdAt: "2026-09-02T10:00:00Z" },
                ],
              },
            },
            pullRequest: null,
          },
        },
      });
    });

    const result = await loadComments(
      { directory: "C:\\repo", kind: "issue", number: 7, remoteName: "origin" },
      { pathExists: async () => true, run },
    );

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({ author: { login: "tim" }, id: "c1" });
    expect(result.comments[1]?.author).toBeNull();
    expect(run.mock.calls.filter(([file]) => file === "gh")).toHaveLength(1);
  });

  it("loads the conversation for a pull request", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      return JSON.stringify({
        data: {
          repository: {
            issue: null,
            pullRequest: {
              comments: {
                nodes: [{ id: "c9", author: { login: "reviewer" }, bodyHTML: "<p>Nit</p>", createdAt: "2026-09-03T10:00:00Z" }],
              },
            },
          },
        },
      });
    });

    const result = await loadComments(
      { directory: "C:\\repo", kind: "pullRequest", number: 42, remoteName: "origin" },
      { pathExists: async () => true, run },
    );

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({ id: "c9", author: { login: "reviewer" } });
  });

  it("reports a missing GitHub item instead of an empty conversation", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      return JSON.stringify({ data: { repository: { issue: null, pullRequest: null } } });
    });

    await expect(
      loadComments(
        { directory: "C:\\repo", kind: "issue", number: 999, remoteName: "origin" },
        { pathExists: async () => true, run },
      ),
    ).rejects.toThrow("not found or is not accessible");
  });

  it("salvages the payload when gh exits non-zero over a GraphQL errors array", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      throw new GitHubCommandError(
        "gh",
        ["api", "graphql"],
        JSON.stringify({
          data: {
            repository: {
              issue: null,
              pullRequest: {
                comments: {
                  nodes: [{ id: "c3", author: { login: "tim" }, bodyHTML: "<p>kept</p>", createdAt: "2026-09-04T10:00:00Z" }],
                },
              },
            },
          },
          errors: [{ message: "Could not resolve to an Issue with the number of 42." }],
        }),
        "gh: Could not resolve to an Issue with the number of 42.",
        1,
      );
    });

    const result = await loadComments(
      { directory: "C:\\repo", kind: "pullRequest", number: 42, remoteName: "origin" },
      { pathExists: async () => true, run },
    );

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({ id: "c3" });
  });

  it("requests only the queried kind so no NOT_FOUND error is produced", async () => {
    const run = vi.fn(async (file: string, args: readonly string[]) => {
      if (file === "git" && args.includes("--is-inside-work-tree")) return "true\n";
      if (file === "git") return "remote.origin.url git@github.com:owner/repo.git\n";
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: { comments: { nodes: [] } },
          },
        },
      });
    });

    await loadComments(
      { directory: "C:\\repo", kind: "pullRequest", number: 42, remoteName: "origin" },
      { pathExists: async () => true, run },
    );

    const ghArgs = run.mock.calls.find(([file]) => file === "gh")?.[1] ?? [];
    const queryArg = ghArgs.find((arg) => arg.startsWith("query=")) ?? "";
    expect(queryArg).toContain("pullRequest(number: $number)");
    expect(queryArg).not.toContain("issue(number:");
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
