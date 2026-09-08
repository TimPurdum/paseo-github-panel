import { describe, expect, it, vi } from "vitest";

import { BoundedImageCache, createImageLoader } from "./image-proxy";

describe("BoundedImageCache", () => {
  it("evicts the least recently used entry rather than the oldest inserted entry", () => {
    const cache = new BoundedImageCache(2, 100);
    cache.set("a", { bytes: Buffer.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" });
    cache.set("b", { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png" });
    cache.get("a");
    cache.set("c", { bytes: Buffer.from([0x47, 0x49, 0x46, 0x38]), mimeType: "image/gif" });

    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("evicts entries until the byte bound is satisfied", () => {
    const cache = new BoundedImageCache(10, 5);
    cache.set("a", { bytes: Buffer.from([1, 2, 3]), mimeType: "image/png" });
    cache.set("b", { bytes: Buffer.from([4, 5, 6]), mimeType: "image/png" });

    expect(cache.get("a")).toBeUndefined();
    expect(cache.sizeBytes).toBe(3);
  });
});

describe("createImageLoader", () => {
  it("rejects a URL outside the GitHub image allow-list before invoking gh", async () => {
    const runBuffer = vi.fn(async () => Buffer.from([]));
    const loadImage = createImageLoader({ runBuffer });

    await expect(loadImage({ url: "https://githubusercontent.com.evil.tld/image.png" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(runBuffer).not.toHaveBeenCalled();
  });

  it("coalesces concurrent loads and returns base64 with a detected MIME type", async () => {
    const runBuffer = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const loadImage = createImageLoader({ runBuffer });

    const [first, second] = await Promise.all([
      loadImage({ url: "https://user-images.githubusercontent.com/image.png" }),
      loadImage({ url: "https://user-images.githubusercontent.com/image.png" }),
    ]);

    expect(first).toEqual(second);
    expect(first.mimeType).toBe("image/png");
    expect(runBuffer).toHaveBeenCalledTimes(1);
  });
});
