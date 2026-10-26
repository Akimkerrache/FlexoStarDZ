import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";

export interface StoredPart {
  partNumber: number;
  etag: string;
}

/** Provider-agnostic object storage. R2 is the production implementation; swap by implementing this interface. */
export interface StorageService {
  createMultipart(key: string, contentType: string): Promise<string>;
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string>;
  completeMultipart(
    key: string,
    uploadId: string,
    parts: StoredPart[],
  ): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  presignPut(
    key: string,
    contentType: string,
    sizeBytes: number,
    ttlSeconds: number,
  ): Promise<string>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  readHead(key: string, bytes: number): Promise<Buffer>;
  presignGet(
    key: string,
    downloadName: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<string>;
  remove(key: string): Promise<void>;
}

export class R2Storage implements StorageService {
  private client: S3Client;
  private bucket = env.R2_BUCKET_NAME;

  constructor() {
    this.client = new S3Client({
      region: env.R2_REGION,
      endpoint:
        env.R2_ENDPOINT ||
        `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // R2 does not support the default CRC32 checksum trailers added by newer SDK versions on presigned URLs.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async createMultipart(key: string, contentType: string) {
    const r = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!r.UploadId) throw new Error("Storage did not return an upload id");
    return r.UploadId;
  }
  presignPart(key: string, uploadId: string, partNumber: number, ttl: number) {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttl },
    );
  }
  async completeMultipart(key: string, uploadId: string, parts: StoredPart[]) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }))
            .sort((a, b) => a.PartNumber - b.PartNumber),
        },
      }),
    );
  }
  async abortMultipart(key: string, uploadId: string) {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }
  presignPut(key: string, contentType: string, sizeBytes: number, ttl: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: ttl },
    );
  }
  async head(key: string) {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: r.ContentLength ?? 0 };
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound")
        return null;
      throw e;
    }
  }
  async readHead(key: string, bytes: number) {
    const r = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${bytes - 1}`,
      }),
    );
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  presignGet(
    key: string,
    downloadName: string,
    contentType: string,
    ttl: number,
  ) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      }),
      { expiresIn: ttl },
    );
  }
  async remove(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

let current: StorageService | undefined;
export const getStorage = (): StorageService => (current ??= new R2Storage());
export const setStorage = (s: StorageService | undefined) => {
  current = s;
};
