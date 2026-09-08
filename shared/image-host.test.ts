import { describe, expect, it } from "vitest";

import { isGitHubImageHost } from "./image-host";

describe("isGitHubImageHost", () => {
  it.each([
    "https://github.com/owner/repo/assets/1/image.png",
    "https://user-images.githubusercontent.com/1/image.png",
    "https://PRIVATE-USER-IMAGES.GITHUBUSERCONTENT.COM/image.png",
  ])("allows GitHub image URL %s", (url) => {
    expect(isGitHubImageHost(url)).toBe(true);
  });

  it.each([
    "https://githubusercontent.com.evil.tld/image.png",
    "https://github.com@evil.tld/image.png",
    "//github.com/owner/repo/image.png",
    "http://github.com/owner/repo/image.png",
    "not a URL",
  ])("rejects untrusted image URL %s", (url) => {
    expect(isGitHubImageHost(url)).toBe(false);
  });
});
