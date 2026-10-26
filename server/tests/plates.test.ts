import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authed,
  buildWorld,
  orderBody,
  resetDb,
  startDb,
  stopDb,
  useFakeStorage,
  type World,
} from "./helpers.js";
import { FileAsset } from "../src/modules/files/file.model.js";

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  w = await buildWorld();
});

const plate = (over: Record<string, unknown> = {}) =>
  authed(w.admin.token).post("/plates", {
    clientId: w.clientA.clientId,
    widthMm: 250,
    heightMm: 120,
    ...over,
  });

describe("photopolymer plates", () => {
  it("calculates surface area on the server and ignores a client-supplied value", async () => {
    const r = await plate({ surfaceCm2: 1 });
    expect(r.status).toBe(201);
    expect(r.body.data.surfaceCm2).toBe(300);
    expect(r.body.data.reference).toMatch(/^PLT-\d{5}$/);
    expect(r.body.data.history[0]).toMatchObject({
      from: null,
      to: "file_received",
    });
  });
  it("rejects invalid or missing dimensions", async () => {
    expect((await plate({ widthMm: 0 })).status).toBe(400);
    expect((await plate({ widthMm: -4 })).status).toBe(400);
    expect((await plate({ heightMm: undefined })).status).toBe(400);
    expect((await plate({ widthMm: "abc" })).status).toBe(400);
    expect((await plate({ clientId: "64b64b64b64b64b64b64b64b" })).status).toBe(
      422,
    );
  });
  it("recalculates surface when dimensions change", async () => {
    const p = (await plate()).body.data;
    const r = await authed(w.admin.token).patch(`/plates/${p.id}`, {
      widthMm: 100,
      heightMm: 50.5,
    });
    expect(r.body.data.surfaceCm2).toBe(50.5);
  });
  it("previews price only when a pricing rule exists, and keeps rule history", async () => {
    const pre = await authed(w.admin.token).post("/plates/calculate", {
      widthMm: 100,
      heightMm: 100,
    });
    expect(pre.body.data).toMatchObject({
      surfaceCm2: 100,
      price: null,
      pricingConfigured: false,
    });
    expect(
      (
        await authed(w.manager.token).post("/plates/pricing-rules", {
          pricePerCm2Minor: 10,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.admin.token).post("/plates/pricing-rules", {
          pricePerCm2Minor: 10,
          minimumChargeMinor: 2000,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await authed(w.admin.token).post("/plates/pricing-rules", {
          pricePerCm2Minor: 12,
          minimumChargeMinor: 2000,
        })
      ).body.data.version,
    ).toBe(2);
    const after = await authed(w.admin.token).post("/plates/calculate", {
      widthMm: 100,
      heightMm: 100,
    });
    expect(after.body.data.price.totalMinor).toBe(2000);
    expect(after.body.data.ruleVersion).toBe(2);
    const rules = await authed(w.admin.token).get("/plates/pricing-rules");
    expect(rules.body.data).toHaveLength(2);
    const p = (await plate({ widthMm: 300, heightMm: 100 })).body.data;
    expect(p.sellingPriceMinor).toBe(3600);
  });
  it("validates status transitions and records history", async () => {
    const p = (await plate()).body.data;
    const s = (to: string, note?: string) =>
      authed(w.admin.token).post(`/plates/${p.id}/status`, {
        status: to,
        note,
      });
    expect((await s("delivered")).status).toBe(422);
    expect((await s("supplier_order")).status).toBe(422);
    expect((await s("technical_verification", "checked")).status).toBe(200);
    expect((await s("supplier_order")).body.error.code).toBe(
      "SUPPLIER_REQUIRED",
    );
    const sup = await authed(w.fullManager.token).post("/suppliers", {
      type: "supplier",
      name: "Engraver",
    });
    await authed(w.admin.token).patch(`/plates/${p.id}`, {
      supplierId: sup.body.data.id,
    });
    for (const to of [
      "supplier_order",
      "engraving",
      "quality_control",
      "shipment",
      "delivered",
    ])
      expect((await s(to)).status).toBe(200);
    const done = await authed(w.admin.token).get(`/plates/${p.id}`);
    expect(done.body.data.history.map((h: any) => h.to)).toEqual([
      "file_received",
      "technical_verification",
      "supplier_order",
      "engraving",
      "quality_control",
      "shipment",
      "delivered",
    ]);
    expect(done.body.data.history[1]).toMatchObject({ note: "checked" });
    expect(done.body.data.actualDate).toBeTruthy();
    expect((await s("engraving")).status).toBe(422);
    expect(
      (await authed(w.admin.token).patch(`/plates/${p.id}`, { colorsCount: 3 }))
        .status,
    ).toBe(422);
  });
  it("limits visibility: clients see their own plates without cost data; printers none", async () => {
    const a = (await plate({ purchasePriceMinor: 500, sellingPriceMinor: 900 }))
      .body.data;
    await authed(w.admin.token).post("/plates", {
      clientId: w.clientB.clientId,
      widthMm: 10,
      heightMm: 10,
    });
    const list = await authed(w.clientA.token).get("/plates");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].purchasePriceMinor).toBeUndefined();
    expect(list.body.data[0].sellingPriceMinor).toBe(900);
    expect((await authed(w.clientB.token).get(`/plates/${a.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await authed(w.clientA.token).post(`/plates/${a.id}/status`, {
          status: "cancelled",
        })
      ).status,
    ).toBe(403);
    expect((await authed(w.printerA.token).get("/plates")).status).toBe(403);
    expect((await authed(w.manager.token).get("/plates")).status).toBe(403);
  });
  it("price edits need financial permission and are kept in history", async () => {
    const { User } = await import("../src/modules/users/user.model.js");
    await User.updateOne(
      { _id: w.manager.id },
      { permissions: ["plates.manage"] },
    );
    const p = (await plate()).body.data;
    expect(
      (
        await authed(w.manager.token).patch(`/plates/${p.id}`, {
          sellingPriceMinor: 5,
        })
      ).status,
    ).toBe(403);
    const r = await authed(w.admin.token).patch(`/plates/${p.id}`, {
      sellingPriceMinor: 5000,
      purchasePriceMinor: 3000,
    });
    expect(r.body.data.priceHistory).toHaveLength(2);
  });
  it("reuses a reference without touching the earlier plate", async () => {
    const p = (await plate()).body.data;
    await authed(w.admin.token).post(`/plates/${p.id}/status`, {
      status: "cancelled",
    });
    const r = await authed(w.admin.token).post(`/plates/${p.id}/reuse`, {});
    expect(r.status).toBe(201);
    expect(r.body.data.reusedFromId).toBe(p.id);
    expect(r.body.data.reference).not.toBe(p.reference);
    expect(r.body.data.status).toBe("file_received");
    expect(
      (await authed(w.admin.token).get(`/plates/${p.id}`)).body.data.status,
    ).toBe("cancelled");
  });
  it("searches by dimensions and keeps previous file versions", async () => {
    const storage = useFakeStorage();
    const p = (await plate()).body.data;
    const up = async (over: Record<string, unknown> = {}) => {
      const s = (
        await authed(w.admin.token).post("/files/uploads", {
          fileName: "plate.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1000,
          plateId: p.id,
          category: "plate_original",
          ...over,
        })
      ).body.data;
      storage.put(s.file.objectKey, 1000);
      return (
        await authed(w.admin.token).post(`/files/${s.file.id}/complete`, {})
      ).body.data;
    };
    const v1 = await up();
    const v2 = await up({
      previousVersionId: v1.id,
      category: "plate_corrected",
    });
    expect(v2.version).toBe(2);
    const files = await authed(w.admin.token).get(`/plates/${p.id}/files`);
    expect(files.body.data).toHaveLength(2);
    expect((await FileAsset.findById(v1.id))!.uploadState).toBe("ready");
    expect(
      (await authed(w.admin.token).get("/plates?widthMm=250&heightMm=120")).body
        .data,
    ).toHaveLength(1);
    expect(
      (await authed(w.admin.token).get("/plates?widthMm=999")).body.data,
    ).toHaveLength(0);
    expect(
      (await authed(w.admin.token).get("/plates?search=plt-0")).body.data
        .length,
    ).toBeGreaterThan(0);
  });
  it("is unrelated to the order status", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    const p = (await plate({ orderId: o.id })).body.data;
    await authed(w.admin.token).post(`/plates/${p.id}/status`, {
      status: "technical_verification",
    });
    expect(
      (await authed(w.admin.token).get(`/orders/${o.id}`)).body.data.status,
    ).toBe("under_approval");
  });
});
