import type { LoadImageRequest, LoadImageResponse } from "../shared/contract";
import { isGitHubImageHost } from "../shared/image-host";
import { asMappedGhError, IMAGE_MAX_BUFFER_BYTES, runBufferCommand, type BufferCommandRunner } from "./process";

export interface CachedImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

export class BoundedImageCache {
  readonly #entries = new Map<string, CachedImage>();
  #sizeBytes = 0;

  public constructor(
    readonly maxEntries: number,
    readonly maxBytes: number,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("maxEntries must be a positive integer.");
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("maxBytes must be a positive integer.");
  }

  public get sizeBytes(): number {
    return this.#sizeBytes;
  }

  public get(key: string): CachedImage | undefined {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  public set(key: string, value: CachedImage): void {
    const previous = this.#entries.get(key);
    if (previous !== undefined) {
      this.#sizeBytes -= previous.bytes.byteLength;
      this.#entries.delete(key);
    }
    if (value.bytes.byteLength > this.maxBytes) return;

    this.#entries.set(key, value);
    this.#sizeBytes += value.bytes.byteLength;
    while (this.#entries.size > this.maxEntries || this.#sizeBytes > this.maxBytes) {
      const leastRecentKey = this.#entries.keys().next().value as string | undefined;
      if (leastRecentKey === undefined) break;
      const removed = this.#entries.get(leastRecentKey);
      this.#entries.delete(leastRecentKey);
      if (removed !== undefined) this.#sizeBytes -= removed.bytes.byteLength;
    }
  }
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function detectImageMimeType(bytes: Buffer): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export interface ImageLoaderDependencies {
  readonly cache?: BoundedImageCache;
  readonly runBuffer?: BufferCommandRunner;
}

export type ImageLoader = (request: LoadImageRequest) => Promise<LoadImageResponse>;

export function createImageLoader(dependencies: ImageLoaderDependencies = {}): ImageLoader {
  const cache = dependencies.cache ?? new BoundedImageCache(64, IMAGE_MAX_BUFFER_BYTES);
  const runBuffer = dependencies.runBuffer ?? runBufferCommand;
  const inFlight = new Map<string, Promise<LoadImageResponse>>();

  return async function loadImage(request: LoadImageRequest): Promise<LoadImageResponse> {
    if (!isGitHubImageHost(request.url)) {
      throw new Error("This image URL is not allowed through the GitHub proxy.");
    }
    const cached = cache.get(request.url);
    if (cached !== undefined) {
      return { base64: cached.bytes.toString("base64"), mimeType: cached.mimeType };
    }
    const pending = inFlight.get(request.url);
    if (pending !== undefined) return pending;

    const operation = (async () => {
      try {
        const bytes = await runBuffer("gh", ["api", request.url]);
        if (bytes.byteLength === 0) throw new Error("GitHub returned an empty image response.");
        const mimeType = detectImageMimeType(bytes);
        if (mimeType === null) throw new Error("GitHub returned an unsupported image format.");
        cache.set(request.url, { bytes, mimeType });
        return { base64: bytes.toString("base64"), mimeType };
      } catch (error) {
        throw asMappedGhError(error);
      } finally {
        inFlight.delete(request.url);
      }
    })();
    inFlight.set(request.url, operation);
    return operation;
  };
}

export const loadImage = createImageLoader();
