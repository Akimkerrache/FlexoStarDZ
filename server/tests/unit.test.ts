import { describe, expect, it } from "vitest";
import {
  computeSurfaceCm2,
  computePlatePrice,
  assertPlateTransition,
} from "../src/modules/photopolymer-plates/plate.model.js";
import {
  BASE_COLORS,
  TRANSITIONS,
  checkTransition,
  computeColorCounts,
  containsArabic,
  toggleAllBaseColors,
  ORDER_STATUSES,
} from "../src/modules/orders/order.rules.js";
import {
  computeLine,
  computeMargin,
  computeTotals,
  toMinor,
} from "../src/utils/money.js";
import { csvCell, toCsv } from "../src/utils/pdf.js";
import {
  planUpload,
  sanitizeFilename,
  sniffMatches,
  validateUpload,
} from "../src/modules/files/file.service.js";
import { loadEnv } from "../src/config/env.js";
import { createOrderInput } from "../src/modules/orders/order.schemas.js";
import { can, type AuthContext } from "../src/config/permissions.js";

const auth = (
  role: AuthContext["role"],
  permissions: AuthContext["permissions"] = [],
): AuthContext => ({ userId: "u", name: "n", role, permissions });

describe("plate surface area", () => {
  it("computes cm² from mm dimensions", () => {
    expect(computeSurfaceCm2(100, 100)).toBe(100);
    expect(computeSurfaceCm2(250, 120)).toBe(300);
  });
  it("rounds to two decimals", () => {
    expect(computeSurfaceCm2(33.33, 33.33)).toBe(11.11);
    expect(computeSurfaceCm2(10.005, 10)).toBe(1);
  });
  it("rejects invalid or missing dimensions", () => {
    for (const [w, h] of [
      [0, 10],
      [-5, 10],
      [undefined, 10],
      [10, NaN],
      ["abc", 10],
      [Infinity, 10],
      [200000, 10],
    ]) {
      expect(() => computeSurfaceCm2(w, h)).toThrow();
    }
  });
});

describe("plate pricing rules", () => {
  it("returns null when no per-cm² rate is configured", () => {
    expect(computePlatePrice(100, null)).toBeNull();
    expect(computePlatePrice(100, { minimumChargeMinor: 500 })).toBeNull();
  });
  it("applies rate, minimum, discount and extra fees", () => {
    expect(computePlatePrice(100, { pricePerCm2Minor: 10 })!.totalMinor).toBe(
      1000,
    );
    const min = computePlatePrice(10, {
      pricePerCm2Minor: 10,
      minimumChargeMinor: 500,
    })!;
    expect(min.totalMinor).toBe(500);
    expect(min.minimumApplied).toBe(true);
    expect(
      computePlatePrice(100, {
        pricePerCm2Minor: 10,
        discountPercent: 10,
        extraFeesMinor: 50,
      })!.totalMinor,
    ).toBe(950);
  });
});

describe("plate status transitions", () => {
  it("allows the defined flow and rejects shortcuts", () => {
    expect(() =>
      assertPlateTransition("file_received", "technical_verification"),
    ).not.toThrow();
    expect(() =>
      assertPlateTransition("quality_control", "shipment"),
    ).not.toThrow();
    expect(() => assertPlateTransition("file_received", "delivered")).toThrow();
    expect(() => assertPlateTransition("delivered", "engraving")).toThrow();
    expect(() => assertPlateTransition("cancelled", "file_received")).toThrow();
  });
});

describe("order colors", () => {
  it('"All" selects every base colour, and clears when all are selected', () => {
    expect(toggleAllBaseColors([])).toEqual([...BASE_COLORS]);
    expect(toggleAllBaseColors(["C", "M"])).toEqual([...BASE_COLORS]);
    expect(toggleAllBaseColors([...BASE_COLORS])).toEqual([]);
  });
  it("counts base colours (deduplicated) and optionally includes Pantone", () => {
    expect(computeColorCounts(["C", "C", "M"], ["P1", "P2"], false)).toEqual({
      baseCount: 2,
      pantoneCount: 2,
      totalCount: 2,
    });
    expect(computeColorCounts(["C", "M"], ["P1", "P2"], true)).toEqual({
      baseCount: 2,
      pantoneCount: 2,
      totalCount: 4,
    });
  });
});

describe("job name rule", () => {
  it("detects Arabic script only", () => {
    expect(containsArabic("قهوة")).toBe(true);
    expect(containsArabic("Café 5kg")).toBe(false);
  });
  it("is enforced by the order schema", () => {
    const base = {
      machineId: "a".repeat(24),
      technicalSpecifications: {
        printDirection: "surface",
        printMaterial: "white",
      },
    };
    expect(
      createOrderInput.safeParse({ ...base, jobName: "قهوة" }).success,
    ).toBe(false);
    expect(
      createOrderInput.safeParse({ ...base, jobName: "Coffee" }).success,
    ).toBe(true);
    expect(
      createOrderInput.safeParse({
        ...base,
        jobName: "Coffee",
        customerNotes: "ملاحظة",
      }).success,
    ).toBe(true);
  });
  it("requires print direction and print material", () => {
    const r = createOrderInput.safeParse({
      machineId: "a".repeat(24),
      jobName: "X",
      technicalSpecifications: {},
    });
    expect(r.success).toBe(false);
  });
  it("requires a barcode number when barcode is enabled", () => {
    const r = createOrderInput.safeParse({
      machineId: "a".repeat(24),
      jobName: "X",
      technicalSpecifications: {
        printDirection: "reverse",
        printMaterial: "white",
        barcode: { enabled: true },
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("order state machine", () => {
  it("every status has a transition entry", () => {
    for (const s of ORDER_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
  });
  it("clients cannot approve, deliver or run production", () => {
    const c = auth("client");
    expect(checkTransition("file_preparation", "under_approval", c).ok).toBe(
      true,
    );
    expect(checkTransition("under_approval", "approved", c).ok).toBe(false);
    expect(checkTransition("in_transit", "delivered", c).ok).toBe(false);
    expect(checkTransition("approved", "in_production", c).ok).toBe(false);
  });
  it("approval needs the approve permission; rejection needs a comment", () => {
    expect(
      checkTransition(
        "under_approval",
        "approved",
        auth("manager", ["orders.view"]),
      ).ok,
    ).toBe(false);
    expect(
      checkTransition(
        "under_approval",
        "approved",
        auth("manager", ["orders.approve"]),
      ).ok,
    ).toBe(true);
    const noNote = checkTransition("under_approval", "rejected", auth("admin"));
    expect(noNote.ok).toBe(false);
    expect(
      checkTransition(
        "under_approval",
        "rejected",
        auth("admin"),
        "blurry file",
      ).ok,
    ).toBe(true);
  });
  it("printers only advance production", () => {
    const p = auth("printer");
    expect(checkTransition("approved", "in_production", p).ok).toBe(true);
    expect(checkTransition("in_production", "packed", p).ok).toBe(true);
    expect(checkTransition("under_approval", "approved", p).ok).toBe(false);
    expect(checkTransition("packed", "delivered", p).ok).toBe(false);
    expect(checkTransition("in_production", "cancelled", p).ok).toBe(false);
  });
  it("rejects undefined edges and leaves terminal states closed", () => {
    expect(
      checkTransition("file_preparation", "delivered", auth("admin")).ok,
    ).toBe(false);
    expect(
      checkTransition("cancelled", "file_preparation", auth("admin")).ok,
    ).toBe(false);
    expect(checkTransition("invoiced", "delivered", auth("admin")).ok).toBe(
      false,
    );
  });
  it("only the system can auto-deliver", () => {
    expect(checkTransition("in_transit", "delivered", "system").ok).toBe(true);
    expect(checkTransition("under_approval", "approved", "system").ok).toBe(
      false,
    );
  });
});

describe("permissions", () => {
  it("managers only have what was granted", () => {
    expect(can(auth("manager", ["orders.view"]), "orders.view")).toBe(true);
    expect(can(auth("manager", ["orders.view"]), "finance.view")).toBe(false);
    expect(can(auth("admin"), "finance.manage")).toBe(true);
    expect(can(auth("client", ["orders.view"]), "orders.view")).toBe(false);
  });
});

describe("money", () => {
  it("computes line and document totals in integer minor units", () => {
    expect(toMinor(19.99)).toBe(1999);
    const l = computeLine({
      quantity: 3,
      unitPriceMinor: 1000,
      discountPercent: 10,
      taxPercent: 19,
    });
    expect(l).toEqual({
      grossMinor: 3000,
      discountMinor: 300,
      netMinor: 2700,
      taxMinor: 513,
      totalMinor: 3213,
    });
    const t = computeTotals([
      { quantity: 1, unitPriceMinor: 1000 },
      { quantity: 2, unitPriceMinor: 500, discountPercent: 50 },
    ]);
    expect(t).toMatchObject({
      subtotalMinor: 2000,
      discountTotalMinor: 500,
      taxTotalMinor: 0,
      grandTotalMinor: 1500,
    });
  });
  it("applies no tax unless a rate is supplied", () => {
    expect(computeLine({ quantity: 1, unitPriceMinor: 1000 }).taxMinor).toBe(0);
  });
  it("separates estimated from actual margin", () => {
    expect(computeMargin(10000, 7000)).toEqual({
      marginMinor: 3000,
      marginPercent: 30,
    });
    expect(computeMargin(0, 100).marginPercent).toBe(0);
  });
});

describe("csv", () => {
  it("escapes quotes/commas and neutralises formula injection", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsv(["A"], [["1"]])).toContain("A\r\n1");
  });
});

describe("upload policy", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\x\\design<1>.pdf")).toBe("design1.pdf");
    expect(sanitizeFilename("   ")).toBe("file");
  });
  it("rejects executables, unknown types and bad sizes", () => {
    expect(() =>
      validateUpload("a.exe", "application/octet-stream", 10),
    ).toThrow();
    expect(() => validateUpload("a.svg", "image/svg+xml", 10)).toThrow();
    expect(() => validateUpload("a.pdf", "text/html", 10)).toThrow();
    expect(() => validateUpload("a.pdf", "application/pdf", 0)).toThrow();
    expect(() =>
      validateUpload("a.pdf", "application/pdf", 2 * 1024 ** 3),
    ).toThrow();
    expect(validateUpload("Design.PDF", "application/pdf", 1000).ext).toBe(
      "pdf",
    );
    expect(() =>
      validateUpload("logo.cdr", "application/octet-stream", 1000),
    ).not.toThrow();
  });
  it("plans single vs multipart uploads within R2 limits", () => {
    expect(planUpload(10 * 1024 ** 2).mode).toBe("single");
    const big = planUpload(1024 ** 3) as any;
    expect(big.mode).toBe("multipart");
    expect(big.partSizeBytes).toBeGreaterThanOrEqual(5 * 1024 ** 2);
    expect(big.partCount).toBeLessThanOrEqual(10000);
    const huge = planUpload(5 * 1024 ** 4) as any;
    expect(huge.partCount).toBeLessThanOrEqual(10000);
  });
  it("checks magic bytes for known formats", () => {
    expect(sniffMatches("pdf", Buffer.from("%PDF-1.4"))).toBe(true);
    expect(sniffMatches("pdf", Buffer.from("MZ\x90\x00"))).toBe(false);
    expect(sniffMatches("ai", Buffer.from("anything"))).toBe(true);
  });
});

describe("environment validation", () => {
  const base = {
    MONGODB_URI: "mongodb://x/y",
    JWT_ACCESS_SECRET: "a".repeat(40),
    JWT_REFRESH_SECRET: "b".repeat(40),
  };
  it("fails early with a clear message", () => {
    expect(() => loadEnv({} as any)).toThrow(/MONGODB_URI/);
    expect(() =>
      loadEnv({ ...base, JWT_ACCESS_SECRET: "short" } as any),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });
  it("enforces production requirements without leaking values", () => {
    let msg = "";
    try {
      loadEnv({ ...base, NODE_ENV: "production" } as any);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/COOKIE_SECURE/);
    expect(msg).toMatch(/R2_BUCKET_NAME/);
    expect(msg).not.toContain("a".repeat(40));
  });
});
