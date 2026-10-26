import { files } from "@/services/api";
import type { FileAsset } from "@/types";

export interface UploadTarget {
  orderId?: string;
  plateId?: string;
  invoiceId?: string;
  deliveryId?: string;
  clientId?: string;
  previousVersionId?: string;
  category?: string;
  accessClass?: "shared" | "internal";
}

export interface UploadHandle {
  promise: Promise<FileAsset>;
  cancel: () => void;
}

const MAX_RETRIES = 3;
const PARALLEL_PARTS = 3;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PUT a blob straight to object storage with progress; resolves with the ETag header (needed for multipart). */
function putBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader("ETag"))
        : reject(new Error(`Storage responded ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (
        signal.aborted ||
        (e as Error).name === "AbortError" ||
        ++attempt >= MAX_RETRIES
      )
        throw e;
      await wait(500 * 2 ** attempt);
    }
  }
}

/**
 * Direct-to-storage upload. The API only issues sessions/signed URLs and verifies the result; file bytes never
 * pass through the Express server. Large files use multipart with per-part retries.
 */
export function uploadFile(
  file: File,
  target: UploadTarget,
  onProgress: (pct: number) => void,
): UploadHandle {
  const ctrl = new AbortController();
  let sessionId: string | null = null;

  const run = async (): Promise<FileAsset> => {
    const { file: asset, upload } = await files.createSession({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      ...target,
    });
    sessionId = asset.id;
    try {
      if (upload.mode === "single") {
        await withRetry(
          () =>
            putBlob(
              upload.url,
              file,
              upload.headers,
              (l) => onProgress(Math.round((l / file.size) * 100)),
              ctrl.signal,
            ),
          ctrl.signal,
        );
      } else {
        const { partSizeBytes, partCount } = upload as {
          partSizeBytes: number;
          partCount: number;
        };
        const loaded = new Array<number>(partCount).fill(0);
        const etags: { partNumber: number; etag: string }[] = [];
        const report = () =>
          onProgress(
            Math.min(
              99,
              Math.round((loaded.reduce((a, b) => a + b, 0) / file.size) * 100),
            ),
          );
        const queue = Array.from({ length: partCount }, (_, i) => i + 1);
        const worker = async () => {
          for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
            const partNumber = n;
            const blob = file.slice(
              (partNumber - 1) * partSizeBytes,
              Math.min(file.size, partNumber * partSizeBytes),
            );
            const etag = await withRetry(async () => {
              // URLs are short-lived: fetch a fresh one on every attempt.
              const { parts } = await files.partUrls(asset.id, [partNumber]);
              loaded[partNumber - 1] = 0;
              const tag = await putBlob(
                parts[0].url,
                blob,
                {},
                (l) => {
                  loaded[partNumber - 1] = l;
                  report();
                },
                ctrl.signal,
              );
              if (!tag)
                throw new Error(
                  "Storage did not return an ETag (check the bucket CORS ExposeHeaders)",
                );
              return tag;
            }, ctrl.signal);
            loaded[partNumber - 1] = blob.size;
            etags.push({ partNumber, etag });
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(PARALLEL_PARTS, partCount) }, worker),
        );
        const done = await files.complete(asset.id, etags);
        onProgress(100);
        return done;
      }
      const done = await files.complete(asset.id);
      onProgress(100);
      return done;
    } catch (e) {
      if (sessionId) await files.abort(sessionId).catch(() => undefined);
      throw e;
    }
  };

  return { promise: run(), cancel: () => ctrl.abort() };
}
