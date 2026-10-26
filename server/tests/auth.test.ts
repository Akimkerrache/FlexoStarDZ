import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  app,
  authed,
  buildWorld,
  login,
  makeUser,
  PASSWORD,
  resetDb,
  startDb,
  stopDb,
  type World,
} from "./helpers.js";
import { User } from "../src/modules/users/user.model.js";

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await resetDb();
  w = await buildWorld();
});

describe("login", () => {
  it("logs in with valid credentials and never returns the password hash", async () => {
    const u = await makeUser("admin");
    const r = await login(u.email);
    expect(r.status).toBe(200);
    expect(r.token).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(r.cookies.join(";")).toMatch(/HttpOnly/i);
  });
  it("returns a generic error for wrong password and unknown email", async () => {
    const u = await makeUser("admin");
    const a = await login(u.email, "wrong-password-123");
    const b = await login("nobody@test.dev");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(a.body.error.code).toBe("INVALID_CREDENTIALS");
  });
  it("rejects disabled users", async () => {
    const u = await makeUser("client", { isActive: false });
    expect((await login(u.email)).status).toBe(401);
  });
  it("rejects tokens of users deactivated after login", async () => {
    const u = await makeUser("manager", { permissions: ["orders.view"] });
    const { token } = await login(u.email);
    expect((await authed(token).get("/auth/me")).status).toBe(200);
    await User.updateOne({ _id: u._id }, { isActive: false });
    expect((await authed(token).get("/auth/me")).status).toBe(401);
  });
  it("rejects missing or malformed bearer tokens", async () => {
    expect((await request(app).get(api("/auth/me"))).status).toBe(401);
    expect((await authed("garbage").get("/auth/me")).status).toBe(401);
  });
});

describe("refresh and logout", () => {
  const csrf = { "X-Requested-With": "XMLHttpRequest" };
  it("rotates refresh tokens and detects reuse", async () => {
    const u = await makeUser("admin");
    const l = await login(u.email);
    const r1 = await request(app)
      .post(api("/auth/refresh"))
      .set(csrf)
      .set("Cookie", l.cookies);
    expect(r1.status).toBe(200);
    expect(r1.body.data.accessToken).toBeTruthy();
    // Old token replayed -> whole family revoked
    const replay = await request(app)
      .post(api("/auth/refresh"))
      .set(csrf)
      .set("Cookie", l.cookies);
    expect(replay.status).toBe(401);
    const r2 = await request(app)
      .post(api("/auth/refresh"))
      .set(csrf)
      .set("Cookie", r1.headers["set-cookie"] as unknown as string[]);
    expect(r2.status).toBe(401);
  });
  it("requires the CSRF header", async () => {
    const u = await makeUser("admin");
    const l = await login(u.email);
    expect(
      (await request(app).post(api("/auth/refresh")).set("Cookie", l.cookies))
        .status,
    ).toBe(403);
  });
  it("logout revokes the refresh token", async () => {
    const u = await makeUser("admin");
    const l = await login(u.email);
    expect(
      (
        await request(app)
          .post(api("/auth/logout"))
          .set(csrf)
          .set("Cookie", l.cookies)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(api("/auth/refresh"))
          .set(csrf)
          .set("Cookie", l.cookies)
      ).status,
    ).toBe(401);
  });
  it("refresh fails once the account is deactivated", async () => {
    const u = await makeUser("client");
    const l = await login(u.email);
    await User.updateOne({ _id: u._id }, { isActive: false });
    expect(
      (
        await request(app)
          .post(api("/auth/refresh"))
          .set(csrf)
          .set("Cookie", l.cookies)
      ).status,
    ).toBe(401);
  });
  it("password change invalidates sessions", async () => {
    const u = await makeUser("client");
    const l = await login(u.email);
    const r = await authed(l.token).post("/auth/change-password", {
      currentPassword: PASSWORD,
      newPassword: "Another-Strong-Pass1",
    });
    expect(r.status).toBe(200);
    expect((await authed(l.token).get("/auth/me")).status).toBe(401);
    expect((await login(u.email, "Another-Strong-Pass1")).status).toBe(200);
  });
});

describe("account creation is admin-only", () => {
  it("there is no public registration route", async () => {
    const r = await request(app)
      .post(api("/auth/register"))
      .send({ email: "a@b.co", password: PASSWORD, role: "admin" });
    expect(r.status).toBe(404);
  });
  it("admin creates manager, client and printer accounts", async () => {
    const m = await authed(w.admin.token).post("/managers", {
      name: "Mo",
      email: "mo@test.dev",
      password: PASSWORD,
    });
    expect(m.status).toBe(201);
    expect(m.body.data.permissions).toEqual([
      "orders.view",
      "orders.create",
      "clients.view",
      "printers.view",
    ]);
    const c = await authed(w.admin.token).post("/clients", {
      legalName: "ACME",
      account: {
        name: "Acme User",
        email: "acme@test.dev",
        password: PASSWORD,
      },
    });
    expect(c.status).toBe(201);
    const login1 = await login("acme@test.dev");
    expect(login1.status).toBe(200);
    expect(
      (await authed(login1.token).get("/auth/me")).body.data.clientId,
    ).toBe(c.body.data.id);
    const p = await authed(w.admin.token).post("/printers", {
      name: "Shop",
      account: {
        name: "Shop User",
        email: "shop@test.dev",
        password: PASSWORD,
      },
    });
    expect(p.status).toBe(201);
    expect(
      (await authed((await login("shop@test.dev")).token).get("/auth/me")).body
        .data.printerId,
    ).toBe(p.body.data.id);
  });
  it("non-admins cannot create accounts or admins", async () => {
    const payload = { name: "X", email: "x@test.dev", password: PASSWORD };
    for (const t of [w.fullManager.token, w.clientA.token, w.printerA.token]) {
      expect((await authed(t).post("/managers", payload)).status).toBe(403);
      expect((await authed(t).post("/users/admins", payload)).status).toBe(403);
      expect(
        (await authed(t).post(`/clients/${w.clientA.clientId}/users`, payload))
          .status,
      ).toBe(403);
      expect(
        (
          await authed(t).post(
            `/printers/${w.printerA.printerId}/users`,
            payload,
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (await authed(w.admin.token).post("/users/admins", payload)).status,
    ).toBe(201);
  });
  it("managers cannot grant permissions to themselves", async () => {
    expect(
      (
        await authed(w.fullManager.token).patch(
          `/managers/${w.fullManager.id}`,
          { permissions: ["finance.manage"] },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authed(w.manager.token).patch("/auth/me", {
          permissions: ["finance.manage"],
          role: "admin",
        } as any)
      ).status,
    ).toBe(400);
  });
  it("deactivating a manager kills their sessions; last admin is protected", async () => {
    const m = await authed(w.admin.token).post("/managers", {
      name: "Mo",
      email: "mo2@test.dev",
      password: PASSWORD,
    });
    const ml = await login("mo2@test.dev");
    expect(
      (
        await authed(w.admin.token).post(
          `/managers/${m.body.data.id}/deactivate`,
        )
      ).status,
    ).toBe(200);
    expect((await authed(ml.token).get("/auth/me")).status).toBe(401);
    expect((await login("mo2@test.dev")).status).toBe(401);
    expect(
      (await authed(w.admin.token).post(`/users/${w.admin.id}/deactivate`))
        .status,
    ).toBe(422);
  });
  it("rejects weak passwords and duplicate emails", async () => {
    expect(
      (
        await authed(w.admin.token).post("/managers", {
          name: "A",
          email: "a1@test.dev",
          password: "short",
        })
      ).status,
    ).toBe(400);
    const ok = { name: "A", email: "dup@test.dev", password: PASSWORD };
    expect((await authed(w.admin.token).post("/managers", ok)).status).toBe(
      201,
    );
    expect((await authed(w.admin.token).post("/managers", ok)).status).toBe(
      409,
    );
  });
});

describe("master data authorization", () => {
  it("client users can only read their own client record", async () => {
    const list = await authed(w.clientA.token).get("/clients");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(w.clientA.clientId);
    expect(
      (await authed(w.clientA.token).get(`/clients/${w.clientB.clientId}`))
        .status,
    ).toBe(404);
    expect(
      (
        await authed(w.clientA.token).patch(`/clients/${w.clientA.clientId}`, {
          legalName: "Hack",
        })
      ).status,
    ).toBe(403);
  });
  it("suppliers are hidden from clients and printers", async () => {
    await authed(w.admin.token).post("/suppliers", {
      type: "supplier",
      name: "Secret Supplier",
      negotiatedPrices: [{ description: "x", unitPriceMinor: 100 }],
    });
    expect((await authed(w.clientA.token).get("/suppliers")).status).toBe(403);
    expect((await authed(w.printerA.token).get("/suppliers")).status).toBe(403);
    expect((await authed(w.manager.token).get("/suppliers")).status).toBe(403);
    expect((await authed(w.fullManager.token).get("/suppliers")).status).toBe(
      200,
    );
  });
  it("managers need explicit permission to manage clients", async () => {
    expect(
      (await authed(w.manager.token).post("/clients", { legalName: "X" }))
        .status,
    ).toBe(403);
    expect((await authed(w.manager.token).get("/clients")).status).toBe(403);
    expect(
      (await authed(w.fullManager.token).post("/clients", { legalName: "X" }))
        .status,
    ).toBe(201);
  });
  it("archives instead of deleting and deactivates linked users", async () => {
    const r = await authed(w.admin.token).post(
      `/clients/${w.clientA.clientId}/archive`,
    );
    expect(r.body.data.isActive).toBe(false);
    expect((await authed(w.clientA.token).get("/auth/me")).status).toBe(401);
    const list = await authed(w.admin.token).get("/clients");
    expect(
      list.body.data.find((c: any) => c.id === w.clientA.clientId),
    ).toBeUndefined();
    const all = await authed(w.admin.token).get(
      "/clients?includeArchived=true",
    );
    expect(
      all.body.data.find((c: any) => c.id === w.clientA.clientId),
    ).toBeTruthy();
  });
  it("mass assignment: unknown fields are not persisted", async () => {
    const r = await authed(w.admin.token).post("/clients", {
      legalName: "Safe",
      isActive: false,
      createdBy: "x",
      code: "MINE-1",
      __proto__: { admin: true },
    });
    expect(r.status).toBe(201);
    expect(r.body.data.isActive).toBe(true);
    expect(r.body.data.createdBy).not.toBe("x");
  });
  it("lists machines from the API only within scope", async () => {
    const r = await authed(w.clientA.token).get("/machines");
    expect(r.body.data.map((m: any) => m.code)).toContain("M1");
  });
});
