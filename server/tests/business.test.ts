import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  api,
  app,
  authed,
  buildWorld,
  orderBody,
  resetDb,
  startDb,
  stopDb,
  type World,
} from "./helpers.js";
import { Invoice } from "../src/modules/invoices/invoice.model.js";
import { Order } from "../src/modules/orders/order.model.js";
import { Delivery } from "../src/modules/deliveries/delivery.routes.js";

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  w = await buildWorld();
});

const A = () => authed(w.admin.token);
const invoice = async (over: Record<string, unknown> = {}, issue = true) => {
  const r = await A().post("/invoices", {
    type: "client",
    clientId: w.clientA.clientId,
    lines: [
      {
        description: "Rolls",
        quantity: 10,
        unitPriceMinor: 10000,
        discountPercent: 10,
      },
      { description: "Plate", quantity: 1, unitPriceMinor: 5000 },
    ],
    ...over,
  });
  if (issue && r.status === 201)
    return (await A().post(`/invoices/${r.body.data.id}/issue`)).body.data;
  return r.body.data;
};
const pay = (
  invoiceId: string,
  amountMinor: number,
  over: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  A().post(
    "/payments",
    {
      invoiceId,
      amountMinor,
      paymentDate: "2026-10-20",
      method: "bank_transfer",
      ...over,
    },
    headers,
  );

describe("invoice calculations", () => {
  it("computes totals on the server and ignores supplied totals", async () => {
    const r = await A().post("/invoices", {
      type: "client",
      clientId: w.clientA.clientId,
      grandTotalMinor: 1,
      lines: [{ description: "x", quantity: 1, unitPriceMinor: 100 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.grandTotalMinor).toBe(100);
    const inv = await invoice();
    expect(inv).toMatchObject({
      subtotalMinor: 105000,
      discountTotalMinor: 10000,
      taxTotalMinor: 0,
      grandTotalMinor: 95000,
      status: "issued",
      outstandingMinor: 95000,
    });
    expect(inv.number).toMatch(/^INV-\d{4}-\d{5}$/);
  });
  it("applies tax only when a rate is explicitly given", async () => {
    const inv = await invoice({
      lines: [
        {
          description: "x",
          quantity: 1,
          unitPriceMinor: 10000,
          taxPercent: 19,
        },
      ],
    });
    expect(inv.taxTotalMinor).toBe(1900);
    expect(inv.grandTotalMinor).toBe(11900);
  });
  it("locks issued invoices and numbers each once", async () => {
    const inv = await invoice();
    expect(
      (
        await A().patch(`/invoices/${inv.id}`, {
          lines: [{ description: "x", quantity: 1, unitPriceMinor: 1 }],
        })
      ).status,
    ).toBe(422);
    expect((await A().post(`/invoices/${inv.id}/issue`)).status).toBe(422);
    const second = await invoice();
    expect(second.number).not.toBe(inv.number);
  });
  it("requires finance permission and hides drafts from clients", async () => {
    const draft = await invoice({}, false);
    expect((await authed(w.manager.token).get("/invoices")).status).toBe(403);
    expect(
      (await authed(w.clientA.token).get(`/invoices/${draft.id}`)).status,
    ).toBe(404);
    const issued = await invoice();
    expect(
      (await authed(w.clientA.token).get(`/invoices/${issued.id}`)).status,
    ).toBe(200);
    expect(
      (await authed(w.clientB.token).get(`/invoices/${issued.id}`)).status,
    ).toBe(404);
    expect(
      (await authed(w.clientA.token).get("/invoices")).body.data,
    ).toHaveLength(1);
    expect((await authed(w.clientA.token).post('/invoices', { type: 'client', clientId: w.clientA.clientId, lines: [{ description: 'x', quantity: 1, unitPriceMinor: 1 }] })).status).toBe(
      403,
    );
    expect((await authed(w.printerA.token).get("/invoices")).status).toBe(403);
  });
});

describe("payments", () => {
  it("records partial then full payments with derived classification and balances", async () => {
    const inv = await invoice();
    const p1 = await pay(inv.id, 30000, { reference: "CHQ-1" });
    expect(p1.status).toBe(201);
    expect(p1.body.data).toMatchObject({
      classification: "partial",
      balanceAfterMinor: 65000,
      direction: "in",
    });
    expect((await A().get(`/invoices/${inv.id}`)).body.data).toMatchObject({
      status: "partially_paid",
      amountPaidMinor: 30000,
      outstandingMinor: 65000,
    });
    const p2 = await pay(inv.id, 65000, { reference: "CHQ-2" });
    expect(p2.body.data.classification).toBe("full");
    expect((await A().get(`/invoices/${inv.id}`)).body.data).toMatchObject({
      status: "paid",
      outstandingMinor: 0,
    });
    expect((await pay(inv.id, 1, { reference: "CHQ-3" })).body.error.code).toBe(
      "INVOICE_NOT_PAYABLE",
    );
  });
  it("rejects overpayments and non-positive amounts", async () => {
    const inv = await invoice();
    expect((await pay(inv.id, 95001)).body.error.code).toBe("OVERPAYMENT");
    expect((await pay(inv.id, 0)).status).toBe(400);
    expect((await pay(inv.id, -5)).status).toBe(400);
    expect((await pay(inv.id, 10.5)).status).toBe(400);
    expect((await Invoice.findById(inv.id))!.amountPaidMinor).toBe(0);
  });
  it("prevents duplicate payments (reference, rapid double-submit, idempotency key)", async () => {
    const inv = await invoice();
    expect((await pay(inv.id, 1000, { reference: "REF-1" })).status).toBe(201);
    expect(
      (await pay(inv.id, 1000, { reference: "REF-1" })).body.error.code,
    ).toBe("DUPLICATE_PAYMENT");
    expect((await pay(inv.id, 500)).status).toBe(201);
    expect((await pay(inv.id, 500)).body.error.code).toBe("DUPLICATE_PAYMENT");
    const k = { "Idempotency-Key": "pay-key-123456" };
    const a = await pay(inv.id, 700, { reference: "R-2" }, k);
    const b = await pay(inv.id, 700, { reference: "R-2" }, k);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await Invoice.findById(inv.id))!.amountPaidMinor).toBe(
      1000 + 500 + 700,
    );
  });
  it("concurrent payments cannot exceed the balance", async () => {
    const inv = await invoice();
    const rs = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        pay(inv.id, 30000, { reference: `C-${i}` }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3);
    expect((await Invoice.findById(inv.id))!.amountPaidMinor).toBe(90000);
  });
  it("is a separate transaction: voiding restores the balance and keeps the record", async () => {
    const inv = await invoice();
    const p = (await pay(inv.id, 95000, { reference: "FULL" })).body.data;
    expect((await Invoice.findById(inv.id))!.status).toBe("paid");
    expect(
      (
        await authed(w.fullManager.token).post(`/payments/${p.id}/void`, {
          reason: "bounced cheque",
        })
      ).status,
    ).toBe(403);
    expect(
      (await A().post(`/payments/${p.id}/void`, { reason: "bounced cheque" }))
        .status,
    ).toBe(200);
    expect(await Invoice.findById(inv.id)).toMatchObject({
      status: "issued",
      amountPaidMinor: 0,
    });
    expect((await pay(inv.id, 95000, { reference: "FULL" })).status).toBe(201); // reference reusable after void
    expect((await A().get("/payments")).body.data).toHaveLength(2);
  });
  it("cannot cancel invoices with payments; drafts cannot receive payments", async () => {
    const inv = await invoice();
    await pay(inv.id, 100, { reference: "x" });
    expect(
      (await A().post(`/invoices/${inv.id}/cancel`, { reason: "mistake" })).body
        .error.code,
    ).toBe("HAS_PAYMENTS");
    const draft = await invoice({}, false);
    expect((await pay(draft.id, 100)).body.error.code).toBe(
      "INVOICE_NOT_PAYABLE",
    );
  });
  it("only finance managers can record payments; clients see their own", async () => {
    const inv = await invoice();
    expect(
      (
        await authed(w.manager.token).post("/payments", {
          invoiceId: inv.id,
          amountMinor: 1,
          paymentDate: "2026-10-20",
          method: "cash",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.clientA.token).post("/payments", {
          invoiceId: inv.id,
          amountMinor: 1,
          paymentDate: "2026-10-20",
          method: "cash",
        })
      ).status,
    ).toBe(403);
    await pay(inv.id, 100, { reference: "a" });
    expect(
      (await authed(w.clientA.token).get("/payments")).body.data,
    ).toHaveLength(1);
    expect(
      (await authed(w.clientB.token).get("/payments")).body.data,
    ).toHaveLength(0);
  });
  it("supplier invoices create outgoing payments (payables)", async () => {
    const sup = (
      await authed(w.fullManager.token).post("/suppliers", {
        type: "supplier",
        name: "S",
      })
    ).body.data;
    const si = (
      await A().post("/invoices", {
        type: "supplier",
        supplierId: sup.id,
        supplierInvoiceNumber: "F-77",
        lines: [{ description: "Polymer", quantity: 1, unitPriceMinor: 20000 }],
      })
    ).body.data;
    expect(si.status).toBe("issued");
    const p = await pay(si.id, 5000, { reference: "S1" });
    expect(p.body.data.direction).toBe("out");
    const dash = (await A().get("/reports/dashboard")).body.data.finance;
    expect(dash).toMatchObject({
      payablesMinor: 15000,
      paymentsMadeMinor: 5000,
      receivablesMinor: 0,
    });
  });
  it("flags overdue invoices", async () => {
    const inv = await invoice({ dueDate: "2020-01-01" });
    expect((await A().get(`/invoices/${inv.id}`)).body.data.status).toBe(
      "overdue",
    );
    expect((await A().get("/invoices?status=overdue")).body.data).toHaveLength(
      1,
    );
    expect((await pay(inv.id, 1000, { reference: "late" })).status).toBe(201);
  });
});

describe("cost and margin", () => {
  it("separates estimated from actual margin using expenses and production costs", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    await A().patch(`/orders/${o.id}`, {
      lineItems: [{ description: "Roll", quantity: 100, unitPriceMinor: 1000 }],
      estimatedCostMinor: 70000,
    });
    let v = (await A().get(`/orders/${o.id}`)).body.data;
    expect(v.margins.estimated).toEqual({
      marginMinor: 30000,
      marginPercent: 30,
    });
    expect(v.margins.actual).toBeNull();
    expect(
      (
        await A().post("/expenses", {
          category: "transport",
          amountMinor: 5000,
          date: "2026-10-01",
          orderId: o.id,
        })
      ).status,
    ).toBe(201);
    const sup = (
      await A().post("/suppliers", {
        type: "subcontractor",
        name: "Printer sub",
      })
    ).body.data;
    const op = (
      await A().post("/production", {
        orderId: o.id,
        executorType: "subcontractor",
        supplierId: sup.id,
        operationType: "printing",
        actualCostMinor: 60000,
      })
    ).body.data;
    v = (await A().get(`/orders/${o.id}`)).body.data;
    expect(v.actualCostMinor).toBe(65000);
    expect(v.margins.actual).toEqual({ marginMinor: 35000, marginPercent: 35 });
    // An expense linked to the operation must not be double counted
    await A().post("/expenses", {
      category: "transport",
      amountMinor: 2000,
      date: "2026-10-02",
      productionOperationId: op.id,
    });
    expect((await Order.findById(o.id))!.actualCostMinor).toBe(65000);
    const dash = (await A().get("/reports/dashboard")).body.data.finance;
    expect(dash.estimatedMarginMinor).toBe(30000);
    expect(dash.actualMarginMinor).toBe(35000);
  });
  it("expenses need finance permission; costs are invisible to limited managers", async () => {
    expect(
      (
        await authed(w.manager.token).post("/expenses", {
          category: "x",
          amountMinor: 1,
          date: "2026-10-01",
        })
      ).status,
    ).toBe(403);
    expect((await authed(w.manager.token).get("/expenses")).status).toBe(403);
    expect((await authed(w.clientA.token).get("/expenses")).status).toBe(403);
  });
});

describe("deliveries", () => {
  const setup = async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    await A().patch(`/orders/${o.id}`, {
      lineItems: [{ description: "Rolls", quantity: 100, unitPriceMinor: 10 }],
    });
    await A().post(`/orders/${o.id}/approve`, {});
    await A().post(`/orders/${o.id}/status`, { status: "in_production" });
    await A().post(`/orders/${o.id}/status`, { status: "packed" });
    const doc = await Order.findById(o.id);
    return { id: o.id as string, lineId: String(doc!.lineItems[0]._id) };
  };
  const deliver = async (orderId: string, lineId: string, quantity: number) => {
    const d = await A().post("/deliveries", {
      orderId,
      lines: [{ lineItemId: lineId, quantity }],
    });
    if (d.status !== 201) return d;
    await A().post(`/deliveries/${d.body.data.id}/status`, {
      status: "delivered",
    });
    return d;
  };
  it("supports partial deliveries and only completes the order when everything is delivered", async () => {
    const { id, lineId } = await setup();
    expect((await deliver(id, lineId, 40)).status).toBe(201);
    expect((await A().get(`/orders/${id}`)).body.data.status).toBe(
      "partially_delivered",
    );
    expect(
      (
        await A().post("/deliveries", {
          orderId: id,
          lines: [{ lineItemId: lineId, quantity: 61 }],
        })
      ).body.error.code,
    ).toBe("EXCEEDS_OUTSTANDING");
    expect(
      (await A().post(`/orders/${id}/status`, { status: "delivered" })).body
        .error.code,
    ).toBe("OUTSTANDING_QUANTITIES");
    expect((await deliver(id, lineId, 60)).status).toBe(201);
    const o = (await A().get(`/orders/${id}`)).body.data;
    expect(o.status).toBe("delivered");
    expect(o.lineItems[0].deliveredQuantity).toBe(100);
    expect(await Delivery.countDocuments({ orderId: id })).toBe(2);
  });
  it("reserves quantities for planned deliveries and enforces access", async () => {
    const { id, lineId } = await setup();
    await A().post("/deliveries", {
      orderId: id,
      lines: [{ lineItemId: lineId, quantity: 70 }],
    });
    expect(
      (
        await A().post("/deliveries", {
          orderId: id,
          lines: [{ lineItemId: lineId, quantity: 31 }],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await authed(w.manager.token).post("/deliveries", {
          orderId: id,
          lines: [],
        })
      ).status,
    ).toBe(403);
    expect(
      (await authed(w.clientA.token).get("/deliveries")).body.data,
    ).toHaveLength(1);
    expect(
      (await authed(w.clientB.token).get("/deliveries")).body.data,
    ).toHaveLength(0);
    expect((await authed(w.printerA.token).get("/deliveries")).status).toBe(
      403,
    );
  });
  it("rejects deliveries for orders that are not ready and non-https tracking links", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    expect(
      (await A().post("/deliveries", { orderId: o.id, lines: [] })).body.error
        .code,
    ).toBe("ORDER_NOT_DELIVERABLE");
    const { id } = await setup();
    expect(
      (
        await A().post("/deliveries", {
          orderId: id,
          lines: [],
          trackingUrl: "http://x.com",
        })
      ).status,
    ).toBe(400);
  });
  it("issuing an invoice for a delivered order marks it invoiced", async () => {
    const { id, lineId } = await setup();
    await deliver(id, lineId, 100);
    const inv = await invoice({ orderIds: [id] });
    expect(inv.status).toBe("issued");
    expect((await A().get(`/orders/${id}`)).body.data.status).toBe("invoiced");
    expect(
      (
        await A().post("/invoices", {
          type: "client",
          clientId: w.clientB.clientId,
          orderIds: [id],
          lines: [{ description: "x", quantity: 1, unitPriceMinor: 1 }],
        })
      ).status,
    ).toBe(422);
  });
});

describe("quotations", () => {
  const q = async () =>
    (
      await A().post("/quotations", {
        clientId: w.clientA.clientId,
        validUntil: "2030-01-01",
        lines: [
          {
            description: "Bags",
            quantity: 1000,
            unitPriceMinor: 20,
            unitCostMinor: 12,
            discountPercent: 5,
          },
        ],
      })
    ).body.data;
  const body = () => ({
    machineId: w.machineId,
    jobName: "From quote",
    technicalSpecifications: {
      printDirection: "surface",
      printMaterial: "white",
    },
  });
  it("calculates totals, cost and margin and hides cost from clients", async () => {
    const quote = await q();
    expect(quote).toMatchObject({
      subtotalMinor: 20000,
      discountTotalMinor: 1000,
      grandTotalMinor: 19000,
      estimatedCostMinor: 12000,
      marginMinor: 7000,
    });
    await A().post(`/quotations/${quote.id}/status`, { status: "sent" });
    const c = (await authed(w.clientA.token).get(`/quotations/${quote.id}`))
      .body.data;
    expect(c.estimatedCostMinor).toBeUndefined();
    expect(c.lines[0].unitCostMinor).toBeUndefined();
    expect(
      (await authed(w.clientB.token).get(`/quotations/${quote.id}`)).status,
    ).toBe(404);
  });
  it("enforces the status flow and locks non-drafts", async () => {
    const quote = await q();
    expect(
      (await A().post(`/quotations/${quote.id}/status`, { status: "accepted" }))
        .status,
    ).toBe(422);
    await A().post(`/quotations/${quote.id}/status`, { status: "sent" });
    expect(
      (await A().patch(`/quotations/${quote.id}`, { notes: "x" })).body.error
        .code,
    ).toBe("QUOTATION_LOCKED");
    expect(
      (
        await authed(w.clientA.token).post(`/quotations/${quote.id}/status`, {
          status: "accepted",
        })
      ).status,
    ).toBe(403);
  });
  it("converts once, even when retried or raced, without losing the quotation", async () => {
    const quote = await q();
    expect(
      (await A().post(`/quotations/${quote.id}/convert`, body())).body.error
        .code,
    ).toBe("QUOTATION_NOT_ACCEPTED");
    await A().post(`/quotations/${quote.id}/status`, { status: "sent" });
    await A().post(`/quotations/${quote.id}/status`, { status: "accepted" });
    const rs = await Promise.all(
      [1, 2, 3].map(() => A().post(`/quotations/${quote.id}/convert`, body())),
    );
    expect(rs.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(new Set(rs.map((r) => r.body.data.orderId)).size).toBe(1);
    expect(await Order.countDocuments({ quotationId: quote.id })).toBe(1);
    const order = (await A().get(`/orders/${rs[0].body.data.orderId}`)).body
      .data;
    expect(order).toMatchObject({
      grandTotalMinor: 19000,
      estimatedCostMinor: 12000,
      clientId: w.clientA.clientId,
    });
    expect((await A().get(`/quotations/${quote.id}`)).body.data).toMatchObject({
      status: "converted",
      convertedOrderId: order.id,
    });
    expect(
      (await A().post(`/quotations/${quote.id}/convert`, body())).body.data
        .replayed,
    ).toBe(true);
  });
  it("expired quotations cannot be accepted", async () => {
    const quote = (
      await A().post("/quotations", {
        clientId: w.clientA.clientId,
        validUntil: "2020-01-01",
        lines: [{ description: "x", quantity: 1, unitPriceMinor: 1 }],
      })
    ).body.data;
    await A().post(`/quotations/${quote.id}/status`, { status: "sent" });
    expect((await A().get("/quotations")).body.data[0].status).toBe("expired");
  });
  it("managers need quotations.manage", async () => {
    expect((await authed(w.manager.token).get("/quotations")).status).toBe(403);
    expect((await authed(w.fullManager.token).get("/quotations")).status).toBe(
      200,
    );
  });
});

describe("production, dashboard, exports and docs", () => {
  it("printers only see and update their own operations and never see costs", async () => {
    const o = (await authed(w.clientA.token).post("/orders", orderBody(w))).body
      .data;
    const op = (
      await A().post("/production", {
        orderId: o.id,
        executorType: "printer",
        printerId: w.printerA.printerId,
        operationType: "printing",
        agreedCostMinor: 5000,
        plannedEnd: "2020-01-01",
      })
    ).body.data;
    expect(
      (await authed(w.printerB.token).get("/production")).body.data,
    ).toHaveLength(0);
    expect(
      (
        await authed(w.printerB.token).post(`/production/${op.id}/status`, {
          status: "in_progress",
        })
      ).status,
    ).toBe(404);
    const mine = (await authed(w.printerA.token).get("/production")).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0].agreedCostMinor).toBeUndefined();
    expect(
      (
        await authed(w.printerA.token).post(`/production/${op.id}/status`, {
          status: "awaiting_approval",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.printerA.token).post(`/production/${op.id}/status`, {
          status: "in_progress",
          quantityProduced: 10,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await authed(w.printerA.token).post(
          `/production/${op.id}/non-conformities`,
          { type: "ink", description: "Smudged", extraCostMinor: 100 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.printerA.token).post(
          `/production/${op.id}/non-conformities`,
          { type: "ink", description: "Smudged" },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await authed(w.printerA.token).patch(`/production/${op.id}`, {
          agreedCostMinor: 1,
        })
      ).status,
    ).toBe(403);
    expect((await A().get("/production?queue=delayed")).body.data).toHaveLength(
      1,
    );
    expect((await authed(w.clientA.token).get("/production")).status).toBe(403);
  });
  it("dashboards are scoped to the caller and never expose finance to unauthorised users", async () => {
    await authed(w.clientA.token).post("/orders", orderBody(w));
    await authed(w.clientB.token).post("/orders", orderBody(w));
    await authed(w.clientB.token).post("/orders", orderBody(w));
    const a = (await authed(w.clientA.token).get("/reports/dashboard")).body
      .data;
    expect(a.scope).toBe("client");
    expect(a.ordersByStatus.under_approval).toBe(1);
    expect(
      (await authed(w.clientB.token).get("/reports/dashboard")).body.data
        .ordersByStatus.under_approval,
    ).toBe(2);
    const admin = (await A().get("/reports/dashboard")).body.data;
    expect(admin.ordersAwaitingApproval).toBe(3);
    expect(admin.clients.total).toBe(2);
    expect(admin.finance).toBeDefined();
    expect(
      (await authed(w.manager.token).get("/reports/dashboard")).body.data
        .finance,
    ).toBeUndefined();
    expect(
      (await authed(w.printerA.token).get("/reports/dashboard")).body.data
        .scope,
    ).toBe("printer");
    const filtered = (
      await A().get(`/reports/dashboard?clientId=${w.clientB.clientId}`)
    ).body.data;
    expect(filtered.ordersAwaitingApproval).toBe(2);
  });
  it("exports are limited to the caller scope and neutralise formulas", async () => {
    await authed(w.clientA.token).post(
      "/orders",
      orderBody(w, { jobName: "=SUM(1+1)" }),
    );
    await authed(w.clientB.token).post(
      "/orders",
      orderBody(w, { jobName: "Other client job" }),
    );
    const mine = await authed(w.clientA.token).get("/reports/export/orders");
    expect(mine.headers["content-type"]).toMatch(/text\/csv/);
    expect(mine.text).toContain("'=SUM(1+1)");
    expect(mine.text).not.toContain("Other client job");
    expect(
      (await authed(w.clientA.token).get("/reports/export/clients")).status,
    ).toBe(403);
    expect(
      (await authed(w.clientA.token).get("/reports/export/expenses")).status,
    ).toBe(403);
    expect(
      (await authed(w.printerA.token).get("/reports/export/invoices")).status,
    ).toBe(403);
    expect((await A().get("/reports/export/orders")).text).toContain(
      "Other client job",
    );
  });
  it("renders PDF documents for authorised users only", async () => {
    const inv = (
      await A().post("/invoices", {
        type: "client",
        clientId: w.clientA.clientId,
        lines: [{ description: "x", quantity: 1, unitPriceMinor: 100 }],
      })
    ).body.data;
    await A().post(`/invoices/${inv.id}/issue`);
    const pdf = await authed(w.clientA.token)
      .get(`/reports/documents/invoice/${inv.id}`)
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on("data", (d) => c.push(d));
        res.on("end", () => cb(null, Buffer.concat(c)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    expect(
      (
        await authed(w.clientB.token).get(
          `/reports/documents/invoice/${inv.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await authed(w.clientA.token).get(
          `/reports/documents/statement/${w.clientB.clientId}`,
        )
      ).status,
    ).toBe(403);
  });
  it("serves OpenAPI generated from the real routes, health, and a JSON 404", async () => {
    const spec = await request(app).get(api("/openapi.json"));
    expect(spec.body.paths["/orders/{id}/status"].post).toBeDefined();
    expect(spec.body.paths["/files/uploads"].post).toBeDefined();
    expect(spec.body.paths["/auth/login"].post.security).toEqual([]);
    expect((await request(app).get("/health")).body.status).toBe("ok");
    const nf = await request(app).get(api("/nope"));
    expect(nf.status).toBe(404);
    expect(nf.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      JSON.stringify(
        (
          await request(app)
            .get(api("/orders/not-an-id"))
            .set("Authorization", "Bearer x")
        ).body,
      ),
    ).not.toMatch(/stack/);
  });
  it("writes audit logs without secrets and only admins can read them", async () => {
    await A().post("/managers", {
      name: "Mo",
      email: "mo@test.dev",
      password: "Sup3r-Secret-Pass!",
    });
    const logs = await A().get("/audit-logs?action=user.created");
    expect(logs.body.data).toHaveLength(1);
    expect(JSON.stringify(logs.body)).not.toMatch(/Sup3r-Secret|passwordHash/);
    expect((await authed(w.fullManager.token).get("/audit-logs")).status).toBe(
      403,
    );
  });
  it("generates notifications and scopes them per user", async () => {
    const o = (
      await authed(w.clientA.token).post(
        "/orders",
        orderBody(w, { requestedDeliveryDate: "2020-01-01" }),
      )
    ).body.data;
    expect((await A().post("/notifications/scan")).status).toBe(200);
    await A().post("/notifications/scan"); // de-duplicated
    const list = await A().get("/notifications");
    expect(
      list.body.data.filter((n: any) => n.type === "order_overdue"),
    ).toHaveLength(1);
    expect(list.body.meta.unread).toBeGreaterThan(0);
    const mine = (await authed(w.clientA.token).get("/notifications")).body
      .data;
    expect(mine.every((n: any) => n.type !== "order_overdue")).toBe(true);
    const n = list.body.data[0];
    expect(
      (await authed(w.clientA.token).post(`/notifications/${n.id}/read`))
        .status,
    ).toBe(404);
    expect(
      (await A().post(`/notifications/${n.id}/read`)).body.data.readAt,
    ).toBeTruthy();
    expect(
      (await authed(w.clientA.token).post("/notifications/scan")).status,
    ).toBe(403);
    void o;
  });
});
