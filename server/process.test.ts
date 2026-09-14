import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CommandLaunchError,
  GitHubCommandError,
  launchCommand,
  mapGhFailure,
  runShellCommand,
} from "./process";

const unauthenticatedStderr = readFileSync(new URL("./fixtures/gh-unauthenticated.txt", import.meta.url), "utf8");
const rateLimitStderr = readFileSync(new URL("./fixtures/gh-rate-limit.txt", import.meta.url), "utf8");
const privateImageStderr = readFileSync(new URL("./fixtures/gh-private-image-404.txt", import.meta.url), "utf8");

describe("launchCommand", () => {
  it("resolves when the command exits successfully", async () => {
    await expect(launchCommand(process.execPath, ["--version"])).resolves.toBeUndefined();
  });

  it("rejects with the exit code when the command fails", async () => {
    await expect(launchCommand(process.execPath, ["-e", "process.exit(3)"])).rejects.toMatchObject({
      causeCode: 3,
    });
  });

  it("rejects with a launch error when the command does not exist", async () => {
    await expect(launchCommand("paseo-github-panel-no-such-command", [])).rejects.toBeInstanceOf(
      CommandLaunchError,
    );
  });
});

describe("runShellCommand", () => {
  it("returns stdout when the command succeeds", async () => {
    const output = await runShellCommand(process.execPath, ["--version"]);
    expect(output.trim()).toMatch(/^v\d+\./);
  });

  it("rejects with the exit code when the command fails", async () => {
    await expect(runShellCommand(process.execPath, ["-e", "process.exit(4)"])).rejects.toMatchObject({
      causeCode: 4,
    });
  });
});

describe("mapGhFailure", () => {
  it("maps missing gh to a daemon-host installation message", () => {
    expect(mapGhFailure(new GitHubCommandError("gh", [], "", "", "ENOENT"))).toMatch(/daemon host.*install/i);
  });

  it("maps authentication stderr to gh auth login", () => {
    expect(mapGhFailure(new GitHubCommandError("gh", [], "", unauthenticatedStderr, 1))).toMatch(
      /gh auth login.*daemon/i,
    );
  });

  it("maps rate limits without discarding the cause", () => {
    expect(mapGhFailure(new GitHubCommandError("gh", [], "", rateLimitStderr, 1))).toMatch(
      /rate limit/i,
    );
  });

  it("preserves a private-resource 404 without exposing credentials", () => {
    const message = mapGhFailure(new GitHubCommandError("gh", [], "", privateImageStderr, 1));
    expect(message).toMatch(/404/);
    expect(message).not.toMatch(/token|authorization/i);
  });
});
