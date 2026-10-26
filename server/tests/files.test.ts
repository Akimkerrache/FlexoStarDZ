import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authed,
  buildWorld,
  orderBody,
  resetDb,
  startDb,
  stopDb,
  useFakeStorage,
  type FakeStorage,
  type World,
} from "./helpers.js";
import { FileAsset } from "../src/modules/files/file.model.js";
import { Order } from "../src/modules/orders/order.model.js";
import { cleanupAbandoned } from "../src/modules/files/file.service.js";

let w: World;
let storage: FakeStorage;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  w = await buildWorld();
  storage = useFakeStorage();
});

const MB = 1024 * 1024;
const session = (token: string, over: Record<string, unknown> = {}) =>
  authed(token).post("/files/uploads", {
    fileName: "design.pdf",
    mimeType: "application/pdf",
    sizeBytes: 5 * MB,
    ...over,
  });

describe("upload authorization", () => {
  it("rejects unauthenticated, printer and cross-client uploads", async () => {
    const { default: request } = await import("supertest");
    const { app, api } = await import("./helpers.js");
    expect(
      (await request(app).post(api("/files/uploads")).send({})).status,
    ).toBe(401);
    expect((await session(w.printerA.token)).status).toBe(403);
    const o = (await authed(w.clientB.token).post("/orders", orderBody(w))).body
      .data;
    expect((await session(w.clientA.token, { orderId: o.id })).status).toBe(
      404,
    );
    expect((await session(w.manager.token, { orderId: o.id })).status).toBe(
      403,
    );
    expect(
      (
        await session(w.clientA.token, {
          invoiceId: "64b64b64b64b64b64b64b64b",
        })
      ).status,
    ).toBe(403);
  });
  it("ignores a client-supplied clientId and forces shared access", async () => {
    const r = await session(w.clientA.token, {
      clientId: w.clientB.clientId,
      accessClass: "internal",
    });
    expect(r.status).toBe(201);
    const f = await FileAsset.findById(r.body.data.file.id);
    expect(String(f!.clientId)).toBe(w.clientA.clientId);
    expect(f!.accessClass).toBe("shared");
  });
});

describe("validation", () => {
  it("rejects bad types, sizes and spoofed mime types", async () => {
    expect(
      (
        await session(w.clientA.token, {
          fileName: "virus.exe",
          mimeType: "application/octet-stream",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await session(w.clientA.token, {
          fileName: "page.html",
          mimeType: "text/html",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await session(w.clientA.token, {
          fileName: "a.pdf",
          mimeType: "text/html",
        })
      ).status,
    ).toBe(422);
    expect(
      (await session(w.clientA.token, { sizeBytes: 2 * 1024 * MB })).body.error
        .code,
    ).toBe("FILE_TOO_LARGE");
    expect((await session(w.clientA.token, { sizeBytes: 0 })).status).toBe(400);
    const r = await session(w.clientA.token, {
      fileName: "../../evil name?.pdf",
    });
    expect(r.body.data.file.originalName).toBe("evil name.pdf");
    expect(r.body.data.file.objectKey).toMatch(
      /^test\/clients\/[a-f0-9]{24}\/[0-9a-f-]{36}\.pdf$/,
    );
  });
  it("rejects content that does not match the extension and cleans the object", async () => {
    const s = (await session(w.clientA.token)).body.data;
    storage.put(s.file.objectKey, 5 * MB, Buffer.from("MZ\x90\x00 not a pdf"));
    const r = await authed(w.clientA.token).post(
      `/files/${s.file.id}/complete`,
      {},
    );
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("CONTENT_MISMATCH");
    expect(storage.objects.has(s.file.objectKey)).toBe(false);
    expect((await FileAsset.findById(s.file.id))!.uploadState).toBe("failed");
  });
});

describe("single upload", () => {
  it("completes after verifying size, then links to the order", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    const s = (await session(w.clientA.token, { orderId: o.id })).body.data;
    expect(s.upload.mode).toBe("single");
    expect(s.upload.url).toContain("https://r2.test/");
    // Not linked to the order until completion
    expect((await Order.findById(o.id))!.fileAssetIds).toHaveLength(0);
    // Missing object
    expect(
      (await authed(w.clientA.token).post(`/files/${s.file.id}/complete`, {}))
        .body.error.code,
    ).toBe("OBJECT_MISSING");
    storage.put(s.file.objectKey, 5 * MB);
    const done = await authed(w.clientA.token).post(
      `/files/${s.file.id}/complete`,
      {},
    );
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      uploadState: "ready",
      version: 1,
      scanStatus: "not_scanned",
    });
    expect((await Order.findById(o.id))!.fileAssetIds.map(String)).toEqual([
      s.file.id,
    ]);
  });
  it("fails when the uploaded size differs from the declared size", async () => {
    const s = (await session(w.clientA.token)).body.data;
    storage.put(s.file.objectKey, 4 * MB);
    const r = await authed(w.clientA.token).post(
      `/files/${s.file.id}/complete`,
      {},
    );
    expect(r.body.error.code).toBe("SIZE_MISMATCH");
  });
});

describe("multipart upload", () => {
  it("runs the full session -> parts -> complete flow for large files", async () => {
    const size = 120 * MB;
    const s = (await session(w.clientA.token, { sizeBytes: size })).body.data;
    expect(s.upload).toMatchObject({
      mode: "multipart",
      partSizeBytes: 10 * MB,
      partCount: 12,
    });
    const parts = await authed(w.clientA.token).post(
      `/files/${s.file.id}/parts`,
      { partNumbers: [1, 2, 3] },
    );
    expect(parts.body.data.parts).toHaveLength(3);
    expect(parts.body.data.parts[0].url).toContain("part=1");
    expect(
      (
        await authed(w.clientA.token).post(`/files/${s.file.id}/parts`, {
          partNumbers: [13],
        })
      ).status,
    ).toBe(422);
    // Incomplete part list rejected
    const partial = await authed(w.clientA.token).post(
      `/files/${s.file.id}/complete`,
      { parts: [{ partNumber: 1, etag: "a" }] },
    );
    expect(partial.body.error.code).toBe("PARTS_INCOMPLETE");
    const all = Array.from({ length: 12 }, (_, i) => ({
      partNumber: i + 1,
      etag: `etag${i}`,
    }));
    storage.put(s.file.objectKey, size);
    const done = await authed(w.clientA.token).post(
      `/files/${s.file.id}/complete`,
      { parts: all },
    );
    expect(done.status).toBe(200);
    expect(storage.completed).toContain(s.file.objectKey);
    expect(done.body.data.uploadState).toBe("ready");
  });
  it("lets the client retry completion if storage rejects the parts", async () => {
    const s = (await session(w.clientA.token, { sizeBytes: 60 * MB })).body
      .data;
    const all = Array.from({ length: s.upload.partCount }, (_, i) => ({
      partNumber: i + 1,
      etag: "e",
    }));
    storage.failComplete = true;
    expect(
      (
        await authed(w.clientA.token).post(`/files/${s.file.id}/complete`, {
          parts: all,
        })
      ).body.error.code,
    ).toBe("STORAGE_COMPLETE_FAILED");
    expect((await FileAsset.findById(s.file.id))!.uploadState).toBe("pending");
  });
  it("aborts safely and refuses further activity", async () => {
    const s = (await session(w.clientA.token, { sizeBytes: 60 * MB })).body
      .data;
    expect(
      (await authed(w.clientB.token).post(`/files/${s.file.id}/abort`)).status,
    ).toBe(404);
    expect(
      (await authed(w.clientA.token).post(`/files/${s.file.id}/abort`)).status,
    ).toBe(200);
    expect(storage.aborted).toContain(s.file.objectKey);
    expect(
      (
        await authed(w.clientA.token).post(`/files/${s.file.id}/parts`, {
          partNumbers: [1],
        })
      ).status,
    ).toBe(409);
    expect(
      (await authed(w.clientA.token).post(`/files/${s.file.id}/complete`, {}))
        .status,
    ).toBe(409);
  });
  it("cleanup aborts abandoned uploads", async () => {
    const s = (await session(w.clientA.token, { sizeBytes: 60 * MB })).body
      .data;
    await FileAsset.collection.updateOne({ _id: new mongoose.Types.ObjectId(s.file.id) }, { $set: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
    expect(await cleanupAbandoned(24)).toBe(1);
    expect((await FileAsset.findById(s.file.id))!.uploadState).toBe("aborted");
    expect(storage.aborted).toHaveLength(1);
  });
});

async function uploadReady(token: string, over: Record<string, unknown> = {}) {
  const s = (await session(token, over)).body.data;
  storage.put(s.file.objectKey, Number(over.sizeBytes ?? 5 * MB));
  const r = await authed(token).post(`/files/${s.file.id}/complete`, {});
  return r.body.data;
}

describe("download authorization and versions", () => {
  it("issues time-limited URLs only to authorised users", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    const f = await uploadReady(w.clientA.token, { orderId: o.id });
    expect(
      (await authed(w.clientA.token).get(`/files/${f.id}/download-url`)).body
        .data.url,
    ).toContain("?get=1");
    expect(
      (await authed(w.clientB.token).get(`/files/${f.id}/download-url`)).status,
    ).toBe(404);
    expect((await authed(w.clientB.token).get(`/files/${f.id}`)).status).toBe(
      404,
    );
    expect(
      (await authed(w.printerA.token).get(`/files/${f.id}/download-url`))
        .status,
    ).toBe(404); // not assigned
    await authed(w.admin.token).post(`/orders/${o.id}/assign`, {
      printerId: w.printerA.printerId,
    });
    expect(
      (await authed(w.printerA.token).get(`/files/${f.id}/download-url`))
        .status,
    ).toBe(200);
    expect(
      (await authed(w.printerB.token).get(`/files/${f.id}/download-url`))
        .status,
    ).toBe(404);
    expect(
      (await authed(w.manager.token).get(`/files/${f.id}/download-url`)).status,
    ).toBe(200);
    const { default: request } = await import("supertest");
    const { app, api } = await import("./helpers.js");
    expect(
      (await request(app).get(api(`/files/${f.id}/download-url`))).status,
    ).toBe(401);
  });
  it("hides internal files from clients and printers", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    await authed(w.admin.token).post(`/orders/${o.id}/assign`, {
      printerId: w.printerA.printerId,
    });
    const internal = await uploadReady(w.admin.token, {
      orderId: o.id,
      accessClass: "internal",
    });
    expect(internal.accessClass).toBe("internal");
    expect(
      (await authed(w.clientA.token).get(`/files/${internal.id}/download-url`))
        .status,
    ).toBe(404);
    expect(
      (await authed(w.printerA.token).get(`/files/${internal.id}/download-url`))
        .status,
    ).toBe(404);
    expect(
      (await authed(w.clientA.token).get(`/orders/${o.id}/files`)).body.data,
    ).toHaveLength(0);
    expect(
      (await authed(w.admin.token).get(`/orders/${o.id}/files`)).body.data,
    ).toHaveLength(1);
    expect(
      (await authed(w.clientA.token).get("/files")).body.data,
    ).toHaveLength(0);
  });
  it("keeps every version and links them to the order", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    const v1 = await uploadReady(w.clientA.token, { orderId: o.id });
    const v2 = await uploadReady(w.clientA.token, {
      orderId: o.id,
      previousVersionId: v1.id,
      fileName: "design-v2.pdf",
    });
    expect(v2.version).toBe(2);
    expect(v2.versionGroupId).toBe(v1.versionGroupId);
    const versions = await authed(w.clientA.token).get(
      `/files/${v2.id}/versions`,
    );
    expect(versions.body.data.map((v: any) => v.version)).toEqual([1, 2]);
    expect((await FileAsset.findById(v1.id))!.uploadState).toBe("ready");
    expect((await Order.findById(o.id))!.fileAssetIds).toHaveLength(2);
    expect(
      (
        await authed(w.clientB.token).post("/files/uploads", {
          fileName: "x.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          previousVersionId: v1.id,
        })
      ).status,
    ).toBe(404);
  });
  it("archives rather than deletes", async () => {
    const f = await uploadReady(w.admin.token, {
      clientId: w.clientA.clientId,
    });
    expect(
      (await authed(w.clientA.token).post(`/files/${f.id}/archive`)).status,
    ).toBe(403);
    expect(
      (await authed(w.admin.token).post(`/files/${f.id}/archive`)).status,
    ).toBe(200);
    expect(await FileAsset.countDocuments({ _id: f.id })).toBe(1);
    expect(storage.objects.size).toBe(1);
  });
});

describe("order <-> file consistency", () => {
  it("only accepts ready files that belong to the same client", async () => {
    const mine = await uploadReady(w.clientA.token);
    const pending = (await session(w.clientA.token)).body.data.file;
    const theirs = await uploadReady(w.clientB.token);
    expect(
      (
        await authed(w.clientA.token).post(
          "/orders",
          orderBody(w, { fileAssetIds: [pending.id] }),
        )
      ).body.error.code,
    ).toBe("FILE_NOT_READY");
    expect(
      (
        await authed(w.clientA.token).post(
          "/orders",
          orderBody(w, { fileAssetIds: [theirs.id] }),
        )
      ).status,
    ).toBe(403);
    const ok = await authed(w.clientA.token).post(
      "/orders",
      orderBody(w, { fileAssetIds: [mine.id] }),
    );
    expect(ok.status).toBe(201);
    expect(String((await FileAsset.findById(mine.id))!.orderId)).toBe(
      ok.body.data.id,
    );
  });
});
