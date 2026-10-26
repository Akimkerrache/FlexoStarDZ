import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/database/index.js';
import { User } from '../src/modules/users/user.model.js';
import { Client } from '../src/modules/clients/client.model.js';
import { Printer } from '../src/modules/printers/printer.routes.js';
import { Machine } from '../src/modules/machines/machine.routes.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { setStorage, type StorageService } from '../src/modules/files/storage.js';
import { PERMISSIONS, type Permission } from '../src/config/permissions.js';

export const app = createApp();
export const api = (path: string) => `/api/v1${path}`;
export const PASSWORD = 'Sup3r-Secret-Pass!';

export async function startDb() {
  await connectDb(process.env.MONGODB_URI);
}
export async function stopDb() {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
}
export async function resetDb() {
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

export async function makeUser(role: 'admin' | 'manager' | 'client' | 'printer', extra: Record<string, unknown> = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  return User.create({ name: `${role} ${n}`, email: `${role}-${n}@test.dev`, passwordHash: await hashPassword(PASSWORD), role, ...extra });
}

export async function login(email: string, password = PASSWORD) {
  const r = await request(app).post(api('/auth/login')).send({ email, password });
  return { status: r.status, token: r.body?.data?.accessToken as string, cookies: r.headers['set-cookie'] as unknown as string[], body: r.body };
}

export const authed = (token: string) => ({
  get: (p: string) => request(app).get(api(p)).set('Authorization', `Bearer ${token}`),
  post: (p: string, body?: object, headers: Record<string, string> = {}) => request(app).post(api(p)).set('Authorization', `Bearer ${token}`).set(headers).send(body),
  patch: (p: string, body?: object) => request(app).patch(api(p)).set('Authorization', `Bearer ${token}`).send(body),
});

export interface World {
  admin: { token: string; id: string; email: string };
  manager: { token: string; id: string };
  fullManager: { token: string; id: string };
  clientA: { token: string; id: string; clientId: string };
  clientB: { token: string; id: string; clientId: string };
  printerA: { token: string; id: string; printerId: string };
  printerB: { token: string; id: string; printerId: string };
  machineId: string;
}

/** Builds one user per role (two clients, two printers) directly in the DB for fast, isolated tests. */
export async function buildWorld(): Promise<World> {
  const admin = await makeUser('admin');
  const mk = async (u: any) => ({ id: String(u._id), token: (await login(u.email)).token });
  const manager = await makeUser('manager', { permissions: ['orders.view'] });
  const fullManager = await makeUser('manager', { permissions: [...PERMISSIONS] as Permission[] });
  const cA = await Client.create({ code: 'CLI-A', legalName: 'Client A' });
  const cB = await Client.create({ code: 'CLI-B', legalName: 'Client B' });
  const pA = await Printer.create({ code: 'PRT-A', name: 'Printer A' });
  const pB = await Printer.create({ code: 'PRT-B', name: 'Printer B' });
  const clientA = await makeUser('client', { clientId: cA._id });
  const clientB = await makeUser('client', { clientId: cB._id });
  const printerA = await makeUser('printer', { printerId: pA._id });
  const printerB = await makeUser('printer', { printerId: pB._id });
  const machine = await Machine.create({ code: 'M1', name: 'Machine 1', maxColors: 8, printWidthMm: 1000 });
  return {
    admin: { ...(await mk(admin)), email: admin.email },
    manager: await mk(manager),
    fullManager: await mk(fullManager),
    clientA: { ...(await mk(clientA)), clientId: String(cA._id) },
    clientB: { ...(await mk(clientB)), clientId: String(cB._id) },
    printerA: { ...(await mk(printerA)), printerId: String(pA._id) },
    printerB: { ...(await mk(printerB)), printerId: String(pB._id) },
    machineId: String(machine._id),
  };
}

export const specs = (over: Record<string, unknown> = {}) => ({
  printDirection: 'surface',
  printMaterial: 'transparent',
  printOptions: { linesGuides: true, logo: false },
  colors: { base: ['C', 'M'], pantone: [] },
  ...over,
});

export const orderBody = (w: World, over: Record<string, unknown> = {}) => ({
  machineId: w.machineId,
  jobName: 'Coffee bag 5kg',
  technicalSpecifications: specs(),
  designLinks: ['https://www.wetransfer.com/downloads/abc'],
  ...over,
});

/** In-memory storage double: records calls and simulates object presence/size. */
export class FakeStorage implements StorageService {
  objects = new Map<string, { size: number; head: Buffer }>();
  aborted: string[] = [];
  completed: string[] = [];
  failComplete = false;
  async createMultipart() { return 'upload-' + Math.random().toString(36).slice(2); }
  async presignPart(key: string, _u: string, n: number) { return `https://r2.test/${key}?part=${n}`; }
  async completeMultipart(key: string) {
    if (this.failComplete) throw new Error('boom');
    this.completed.push(key);
  }
  async abortMultipart(key: string) { this.aborted.push(key); }
  async presignPut(key: string) { return `https://r2.test/${key}?put=1`; }
  async head(key: string) { const o = this.objects.get(key); return o ? { sizeBytes: o.size } : null; }
  async readHead(key: string) { return this.objects.get(key)?.head ?? Buffer.alloc(0); }
  async presignGet(key: string) { return `https://r2.test/${key}?get=1`; }
  async remove(key: string) { this.objects.delete(key); }
  put(key: string, size: number, head = Buffer.from('%PDF-1.7')) { this.objects.set(key, { size, head }); }
}
export function useFakeStorage() {
  const s = new FakeStorage();
  setStorage(s);
  return s;
}
