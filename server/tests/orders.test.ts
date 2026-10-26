import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authed,
  buildWorld,
  orderBody,
  resetDb,
  specs,
  startDb,
  stopDb,
  type World,
} from "./helpers.js";
import { PantoneColor } from "../src/modules/settings/technical.routes.js";
import { Order } from "../src/modules/orders/order.model.js";
import { Machine } from "../src/modules/machines/machine.routes.js";

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  w = await buildWorld();
});

const clientOrder = async (over: Record<string, unknown> = {}) =>
  authed(w.clientA.token).post("/orders", orderBody(w, over));
const assign = (id: string) =>
  authed(w.admin.token).post(`/orders/${id}/assign`, {
    printerId: w.printerA.printerId,
  });

describe("order creation", () => {
  it("lets a client create an order for their own account, with initial history", async () => {
    const r = await clientOrder({ clientId: w.clientB.clientId }); // spoofed clientId must be ignored
    expect(r.status).toBe(201);
    expect(r.body.data.clientId).toBe(w.clientA.clientId);
    expect(r.body.data.status).toBe("under_approval");
    expect(r.body.data.jobCode).toMatch(/^\d{9}$/);
    expect(r.body.data.statusHistory).toHaveLength(1);
    expect(r.body.data.statusHistory[0]).toMatchObject({
      from: null,
      to: "under_approval",
      byRole: "client",
    });
    expect(r.body.data.technicalSpecifications.printOptions).toEqual({
      linesGuides: true,
      logo: false,
    });
  });
  it("generates unique job codes under concurrency", async () => {
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => clientOrder()),
    );
    const codes = rs.map((r) => r.body.data.jobCode);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(codes).size).toBe(8);
  });
  it("validates required fields with useful messages", async () => {
    const r = await authed(w.clientA.token).post("/orders", {
      jobName: "",
      technicalSpecifications: {},
    });
    expect(r.status).toBe(400);
    const fields = r.body.error.details.map((d: any) => d.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        "machineId",
        "jobName",
        "technicalSpecifications.printDirection",
        "technicalSpecifications.printMaterial",
      ]),
    );
  });
  it("rejects Arabic letters in the job name but accepts them in notes", async () => {
    expect((await clientOrder({ jobName: "قهوة" })).status).toBe(400);
    expect(
      (await clientOrder({ customerNotes: "ملاحظات للطباعة" })).status,
    ).toBe(201);
  });
  it("validates referenced client and machine on the server", async () => {
    const bad = "64b64b64b64b64b64b64b64b";
    const m = await clientOrder({ machineId: bad });
    expect(m.status).toBe(422);
    expect(m.body.error.code).toBe("INVALID_REFERENCE");
    const staffNoClient = await authed(w.fullManager.token).post(
      "/orders",
      orderBody(w),
    );
    expect(staffNoClient.status).toBe(422);
    expect(staffNoClient.body.error.code).toBe("CLIENT_REQUIRED");
    const staffBadClient = await authed(w.fullManager.token).post(
      "/orders",
      orderBody(w, { clientId: bad }),
    );
    expect(staffBadClient.status).toBe(422);
    const ok = await authed(w.fullManager.token).post(
      "/orders",
      orderBody(w, { clientId: w.clientA.clientId }),
    );
    expect(ok.status).toBe(201);
  });
  it("rejects non-https design links", async () => {
    expect(
      (await clientOrder({ designLinks: ["javascript:alert(1)"] })).status,
    ).toBe(422);
    expect(
      (await clientOrder({ designLinks: ["http://insecure.example.com/x"] }))
        .status,
    ).toBe(422);
    expect(
      (await clientOrder({ designLinks: ["https://user:pw@example.com/x"] }))
        .status,
    ).toBe(422);
  });
  it("managers without orders.create cannot create orders", async () => {
    const r = await authed(w.manager.token).post(
      "/orders",
      orderBody(w, { clientId: w.clientA.clientId }),
    );
    expect(r.status).toBe(403);
  });
  it("is idempotent with an Idempotency-Key header", async () => {
    const key = { "Idempotency-Key": "key-12345678" };
    const a = await authed(w.clientA.token).post("/orders", orderBody(w), key);
    const b = await authed(w.clientA.token).post("/orders", orderBody(w), key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await Order.countDocuments()).toBe(1);
  });
  it("concurrent retries with the same key create one order", async () => {
    const key = { "Idempotency-Key": "race-key-12345" };
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        authed(w.clientA.token).post("/orders", orderBody(w), key),
      ),
    );
    expect(rs.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await Order.countDocuments()).toBe(1);
  });
  it("ignores prices and internal notes sent by clients", async () => {
    const r = await clientOrder({
      internalNotes: "secret",
      lineItems: [{ description: "Roll", quantity: 10, unitPriceMinor: 5 }],
    });
    expect(r.status).toBe(201);
    const o = await Order.findById(r.body.data.id).lean<any>();
    expect(o.internalNotes).toBeUndefined();
    expect(o.lineItems[0].unitPriceMinor).toBe(0);
    expect(o.grandTotalMinor).toBe(0);
  });
});

describe("colors", () => {
  it("derives counts server-side and validates Pantone codes and machine limits", async () => {
    await PantoneColor.create({ code: "PANTONE 185 C", name: "Red" });
    const r = await clientOrder({
      technicalSpecifications: specs({
        colors: { base: ["C", "M", "M", "Y"], pantone: ["PANTONE 185 C"] },
      }),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.technicalSpecifications.colors).toMatchObject({
      base: ["C", "M", "Y"],
      baseCount: 3,
      pantoneCount: 1,
      totalCount: 3,
    });
    expect(
      (
        await clientOrder({
          technicalSpecifications: specs({
            colors: { base: ["C"], pantone: ["NOPE"] },
          }),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await clientOrder({
          technicalSpecifications: specs({
            colors: { base: ["X"], pantone: [] },
          }),
        })
      ).status,
    ).toBe(400);
    await Machine.updateOne({ _id: w.machineId }, { maxColors: 2 });
    const over = await clientOrder({
      technicalSpecifications: specs({
        colors: { base: ["C", "M", "Y"], pantone: [] },
      }),
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("COLOR_LIMIT_EXCEEDED");
  });
});

describe("order isolation", () => {
  it("clients only see and open their own orders", async () => {
    const a = (await clientOrder()).body.data;
    const b = (await authed(w.clientB.token).post("/orders", orderBody(w))).body
      .data;
    const list = await authed(w.clientA.token).get("/orders");
    expect(list.body.data.map((o: any) => o.id)).toEqual([a.id]);
    expect((await authed(w.clientA.token).get(`/orders/${b.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await authed(w.clientA.token).patch(`/orders/${b.id}`, {
          jobName: "hack",
        })
      ).status,
    ).toBe(404);
    expect(
      (await authed(w.clientA.token).post(`/orders/${b.id}/reorder`)).status,
    ).toBe(404);
    expect(
      (await authed(w.clientA.token).get(`/orders/${b.id}/history`)).status,
    ).toBe(404);
    expect(
      (
        await authed(w.clientA.token).get(
          `/orders?clientId=${w.clientB.clientId}`,
        )
      ).body.data,
    ).toHaveLength(1);
  });
  it("printers only see orders assigned to their shop", async () => {
    const o = (await clientOrder()).body.data;
    expect(
      (await authed(w.printerA.token).get("/orders")).body.data,
    ).toHaveLength(0);
    expect((await authed(w.printerA.token).get(`/orders/${o.id}`)).status).toBe(
      404,
    );
    await assign(o.id);
    expect(
      (await authed(w.printerA.token).get("/orders")).body.data,
    ).toHaveLength(1);
    expect((await authed(w.printerA.token).get(`/orders/${o.id}`)).status).toBe(
      200,
    );
    expect((await authed(w.printerB.token).get(`/orders/${o.id}`)).status).toBe(
      404,
    );
    expect(
      (
        await authed(w.printerB.token).post(`/orders/${o.id}/status`, {
          status: "in_production",
        })
      ).status,
    ).toBe(404);
  });
  it("managers without orders.view see nothing", async () => {
    const { Order: O } = await import("../src/modules/orders/order.model.js");
    void O;
    const m = await authed(w.manager.token).get("/orders");
    expect(m.status).toBe(200); // has orders.view
    const { User } = await import("../src/modules/users/user.model.js");
    await User.updateOne({ _id: w.manager.id }, { permissions: [] });
    expect((await authed(w.manager.token).get("/orders")).status).toBe(403);
  });
  it("hides internal data and money from clients and printers", async () => {
    const o = (await clientOrder()).body.data;
    await assign(o.id);
    await authed(w.admin.token).patch(`/orders/${o.id}`, {
      internalNotes: "margin is thin",
      printerNotes: "use plate B",
      estimatedCostMinor: 5000,
      lineItems: [{ description: "Roll", quantity: 10, unitPriceMinor: 1000 }],
    });
    const asClient = (await authed(w.clientA.token).get(`/orders/${o.id}`)).body
      .data;
    expect(asClient.internalNotes).toBeUndefined();
    expect(asClient.printerNotes).toBeUndefined();
    expect(asClient.estimatedCostMinor).toBeUndefined();
    expect(asClient.assignedPrinterId).toBeUndefined();
    expect(asClient.grandTotalMinor).toBe(10000);
    expect(
      asClient.activityHistory.every((a: any) => a.visibility !== "internal"),
    ).toBe(true);
    const asPrinter = (await authed(w.printerA.token).get(`/orders/${o.id}`))
      .body.data;
    expect(asPrinter.internalNotes).toBeUndefined();
    expect(asPrinter.grandTotalMinor).toBeUndefined();
    expect(asPrinter.lineItems[0].unitPriceMinor).toBeUndefined();
    expect(asPrinter.printerNotes).toBe("use plate B");
    expect(asPrinter.clientId).toBeUndefined();
    const asLimitedManager = (
      await authed(w.manager.token).get(`/orders/${o.id}`)
    ).body.data;
    expect(asLimitedManager.grandTotalMinor).toBeUndefined();
    expect(asLimitedManager.internalNotes).toBe("margin is thin");
    const asAdmin = (await authed(w.admin.token).get(`/orders/${o.id}`)).body
      .data;
    expect(asAdmin.margins.estimated.marginMinor).toBe(5000);
  });
});

describe("order editing permissions", () => {
  it("clients may edit only while the order is editable and only allowed fields", async () => {
    const o = (await clientOrder({ submit: false })).body.data;
    expect(o.status).toBe("file_preparation");
    expect(
      (
        await authed(w.clientA.token).patch(`/orders/${o.id}`, {
          jobName: "New name",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.clientA.token).patch(`/orders/${o.id}`, {
          internalNotes: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.clientA.token).patch(`/orders/${o.id}`, {
          estimatedCostMinor: 1,
        })
      ).status,
    ).toBe(403);
    await authed(w.clientA.token).post(`/orders/${o.id}/status`, {
      status: "under_approval",
    });
    expect(
      (
        await authed(w.clientA.token).patch(`/orders/${o.id}`, {
          jobName: "Too late",
        })
      ).status,
    ).toBe(403);
  });
  it("printers can only change printer notes", async () => {
    const o = (await clientOrder()).body.data;
    await assign(o.id);
    expect(
      (
        await authed(w.printerA.token).patch(`/orders/${o.id}`, {
          printerNotes: "ink low",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.printerA.token).patch(`/orders/${o.id}`, {
          jobName: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.printerA.token).patch(`/orders/${o.id}`, {
          priority: "urgent",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.printerA.token).post(`/orders/${o.id}/assign`, {
          printerId: w.printerB.printerId,
        })
      ).status,
    ).toBe(403);
  });
  it("managers: assignment and pricing depend on permissions", async () => {
    const o = (await clientOrder()).body.data;
    expect(
      (
        await authed(w.manager.token).post(`/orders/${o.id}/assign`, {
          printerId: w.printerA.printerId,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.manager.token).patch(`/orders/${o.id}`, {
          internalNotes: "x",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.fullManager.token).post(`/orders/${o.id}/assign`, {
          printerId: w.printerA.printerId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.fullManager.token).post(`/orders/${o.id}/assign`, {
          printerId: "64b64b64b64b64b64b64b64b",
        })
      ).status,
    ).toBe(422);
  });
  it("server recalculates totals and records price changes", async () => {
    const o = (await clientOrder()).body.data;
    const r = await authed(w.admin.token).patch(`/orders/${o.id}`, {
      lineItems: [
        {
          description: "A",
          quantity: 2,
          unitPriceMinor: 1000,
          discountPercent: 10,
          taxPercent: 19,
        },
        { description: "B", quantity: 1, unitPriceMinor: 500 },
      ],
      grandTotalMinor: 1,
    } as any);
    expect(r.status).toBe(400); // client-supplied totals are rejected outright
    const ok = await authed(w.admin.token).patch(`/orders/${o.id}`, {
      lineItems: [
        {
          description: "A",
          quantity: 2,
          unitPriceMinor: 1000,
          discountPercent: 10,
          taxPercent: 19,
        },
        { description: "B", quantity: 1, unitPriceMinor: 500 },
      ],
    });
    expect(ok.body.data).toMatchObject({
      subtotalMinor: 2500,
      discountTotalMinor: 200,
      taxTotalMinor: 342,
      grandTotalMinor: 2642,
    });
    const { AuditLog } =
      await import("../src/modules/audit-logs/audit.service.js");
    expect(
      await AuditLog.countDocuments({ action: "order.price_changed" }),
    ).toBe(1);
  });
});

describe("order workflow", () => {
  it("walks the happy path with history and allowed transitions", async () => {
    const o = (await clientOrder()).body.data;
    expect(o.allowedTransitions).toEqual([]);
    expect(
      (await authed(w.fullManager.token).post(`/orders/${o.id}/approve`, {}))
        .body.data.status,
    ).toBe("approved");
    await assign(o.id);
    for (const s of [
      "plate_processing",
      "in_production",
      "packed",
      "in_transit",
    ]) {
      const r = await authed(w.printerA.token).post(`/orders/${o.id}/status`, {
        status: s,
      });
      expect(r.status).toBe(200);
    }
    expect(
      (
        await authed(w.printerA.token).post(`/orders/${o.id}/status`, {
          status: "delivered",
        })
      ).status,
    ).toBe(403);
    const done = await authed(w.admin.token).post(`/orders/${o.id}/status`, {
      status: "delivered",
    });
    expect(done.status).toBe(200);
    expect(done.body.data.statusHistory.map((h: any) => h.to)).toEqual([
      "under_approval",
      "approved",
      "plate_processing",
      "in_production",
      "packed",
      "in_transit",
      "delivered",
    ]);
    expect(done.body.data.statusHistory.every((h: any) => h.by && h.at)).toBe(
      true,
    );
  });
  it("clients cannot approve or deliver; invalid transitions are rejected", async () => {
    const o = (await clientOrder()).body.data;
    const c = authed(w.clientA.token);
    expect((await c.post(`/orders/${o.id}/approve`, {})).status).toBe(403);
    expect(
      (await c.post(`/orders/${o.id}/status`, { status: "delivered" })).status,
    ).toBe(422);
    expect(
      (await authed(w.manager.token).post(`/orders/${o.id}/approve`, {}))
        .status,
    ).toBe(403);
    await authed(w.admin.token).post(`/orders/${o.id}/approve`, {});
    expect(
      (await c.post(`/orders/${o.id}/status`, { status: "in_production" }))
        .status,
    ).toBe(403);
    expect(
      (
        await authed(w.admin.token).post(`/orders/${o.id}/status`, {
          status: "packed",
        })
      ).status,
    ).toBe(422);
  });
  it("rejection needs a comment, records the approval decision, and can be resubmitted", async () => {
    const o = (await clientOrder()).body.data;
    expect(
      (await authed(w.admin.token).post(`/orders/${o.id}/reject`, {})).status,
    ).toBe(422);
    const r = await authed(w.admin.token).post(`/orders/${o.id}/reject`, {
      note: "File resolution too low",
    });
    expect(r.body.data.status).toBe("rejected");
    expect(r.body.data.approval).toMatchObject({
      status: "rejected",
      comment: "File resolution too low",
    });
    expect(
      (
        await authed(w.clientA.token).post(`/orders/${o.id}/status`, {
          status: "file_preparation",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.clientA.token).post(`/orders/${o.id}/status`, {
          status: "under_approval",
        })
      ).status,
    ).toBe(200);
  });
  it("cancelled and closed orders cannot move again", async () => {
    const o = (await clientOrder({ submit: false })).body.data;
    expect(
      (
        await authed(w.clientA.token).post(`/orders/${o.id}/status`, {
          status: "cancelled",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.admin.token).post(`/orders/${o.id}/status`, {
          status: "file_preparation",
        })
      ).status,
    ).toBe(422);
  });
  it("printers can report issues; staff are notified", async () => {
    const o = (await clientOrder()).body.data;
    await assign(o.id);
    const r = await authed(w.printerA.token).post(`/orders/${o.id}/issues`, {
      kind: "delay",
      description: "Machine maintenance",
    });
    expect(r.status).toBe(201);
    const { Notification } =
      await import("../src/modules/notifications/notification.model.js");
    expect(
      await Notification.countDocuments({
        userId: w.admin.id,
        type: "non_conformity",
      }),
    ).toBe(1);
    expect(
      (
        await authed(w.printerB.token).post(`/orders/${o.id}/issues`, {
          kind: "delay",
          description: "nope nope",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await authed(w.clientA.token).post(`/orders/${o.id}/issues`, {
          kind: "delay",
          description: "nope nope",
        })
      ).status,
    ).toBe(403);
  });
});

describe("reorder", () => {
  it("creates a fresh order that keeps technical data but none of the history", async () => {
    const o = (await clientOrder({ customerNotes: "same as before" })).body
      .data;
    await authed(w.admin.token).post(`/orders/${o.id}/approve`, {});
    await authed(w.admin.token).post(`/orders/${o.id}/assign`, {
      printerId: w.printerA.printerId,
      managerId: w.fullManager.id,
    });
    await authed(w.admin.token).patch(`/orders/${o.id}`, {
      internalNotes: "private",
    });
    await Order.updateOne(
      { _id: o.id },
      {
        invoiceIds: ["64b64b64b64b64b64b64b64b"],
        deliveryIds: ["64b64b64b64b64b64b64b64c"],
        status: "delivered",
      },
    );
    const r = await authed(w.clientA.token).post(`/orders/${o.id}/reorder`);
    expect(r.status).toBe(201);
    const n = await Order.findById(r.body.data.id).lean<any>();
    expect(n.jobCode).not.toBe(o.jobCode);
    expect(String(n.reorderOfId)).toBe(o.id);
    expect(n.status).toBe("file_preparation");
    expect(n.statusHistory).toHaveLength(1);
    expect(n.invoiceIds).toHaveLength(0);
    expect(n.deliveryIds).toHaveLength(0);
    expect(n.assignedPrinterId).toBeUndefined();
    expect(n.internalNotes).toBeUndefined();
    expect(n.approval.status).toBe("none");
    expect(n.technicalSpecifications.printDirection).toBe("surface");
    expect(n.customerNotes).toBe("same as before");
  });
  it("is not available to other clients or managers without orders.create", async () => {
    const o = (await clientOrder()).body.data;
    expect(
      (await authed(w.clientB.token).post(`/orders/${o.id}/reorder`)).status,
    ).toBe(404);
    expect(
      (await authed(w.manager.token).post(`/orders/${o.id}/reorder`)).status,
    ).toBe(403);
    expect(
      (await authed(w.fullManager.token).post(`/orders/${o.id}/reorder`))
        .status,
    ).toBe(201);
  });
  it("is idempotent with a key", async () => {
    const o = (await clientOrder()).body.data;
    const h = { "Idempotency-Key": "reorder-key-1" };
    const a = await authed(w.clientA.token).post(
      `/orders/${o.id}/reorder`,
      undefined,
      h,
    );
    const b = await authed(w.clientA.token).post(
      `/orders/${o.id}/reorder`,
      undefined,
      h,
    );
    expect(b.body.data.id).toBe(a.body.data.id);
  });
});
