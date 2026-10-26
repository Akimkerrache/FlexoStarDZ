import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createSession: vi.fn(), partUrls: vi.fn(), complete: vi.fn(), abort: vi.fn(),
}));
vi.mock('@/services/api', () => ({ files: api }));

import { uploadFile } from './upload';

class FakeXhr {
  static puts: string[] = [];
  static failFirstOf = new Set<string>();
  static seen = new Set<string>();
  upload: any = {};
  status = 200;
  onload: any; onerror: any; onabort: any;
  private url = '';
  open(_m: string, url: string) { this.url = url; }
  setRequestHeader() {}
  getResponseHeader() { return `"etag-${this.url.split('part=')[1] ?? 'single'}"`; }
  abort() { this.onabort?.(); }
  send(blob: Blob) {
    FakeXhr.puts.push(this.url);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: blob.size });
      if (FakeXhr.failFirstOf.has(this.url) && !FakeXhr.seen.has(this.url)) { FakeXhr.seen.add(this.url); this.status = 500; }
      this.onload();
    }, 0);
  }
}

const file = (size: number) => new File([new Uint8Array(size)], 'design.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  FakeXhr.puts = []; FakeXhr.failFirstOf = new Set(); FakeXhr.seen = new Set();
  Object.values(api).forEach((m) => m.mockReset());
  api.abort.mockResolvedValue({});
});

describe('uploadFile', () => {
  it('uploads small files with a single signed PUT and completes', async () => {
    api.createSession.mockResolvedValue({ file: { id: 'f1' }, upload: { mode: 'single', url: 'https://r2/x?put=1', headers: { 'Content-Type': 'application/pdf' } } });
    api.complete.mockResolvedValue({ id: 'f1', uploadState: 'ready' });
    const progress: number[] = [];
    const r = await uploadFile(file(1000), { clientId: 'c1' }, (p) => progress.push(p)).promise;
    expect(r.uploadState).toBe('ready');
    expect(FakeXhr.puts).toEqual(['https://r2/x?put=1']);
    expect(api.complete).toHaveBeenCalledWith('f1');
    expect(progress.at(-1)).toBe(100);
  });

  it('uploads multipart parts directly, retries a failed part, and reports ETags', async () => {
    api.createSession.mockResolvedValue({ file: { id: 'f2' }, upload: { mode: 'multipart', partSizeBytes: 400, partCount: 3 } });
    api.partUrls.mockImplementation(async (_id: string, nums: number[]) => ({ parts: nums.map((n) => ({ partNumber: n, url: `https://r2/k?part=${n}` })) }));
    FakeXhr.failFirstOf.add('https://r2/k?part=2');
    api.complete.mockResolvedValue({ id: 'f2', uploadState: 'ready' });
    await uploadFile(file(1000), {}, () => undefined).promise;
    expect(FakeXhr.puts.filter((u) => u.endsWith('part=2'))).toHaveLength(2); // retried once with a fresh URL
    const parts = api.complete.mock.calls[0][1] as { partNumber: number; etag: string }[];
    expect(parts.map((p) => p.partNumber).sort()).toEqual([1, 2, 3]);
    expect(parts.every((p) => p.etag.startsWith('"etag-'))).toBe(true);
  });

  it('aborts the server-side session when the upload fails', async () => {
    api.createSession.mockResolvedValue({ file: { id: 'f3' }, upload: { mode: 'single', url: 'https://r2/y', headers: {} } });
    vi.stubGlobal('XMLHttpRequest', class extends FakeXhr { send() { setTimeout(() => { this.status = 500; this.onload(); }, 0); } });
    await expect(uploadFile(file(10), {}, () => undefined).promise).rejects.toThrow();
    expect(api.abort).toHaveBeenCalledWith('f3');
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('cancel aborts the in-flight request and the session', async () => {
    api.createSession.mockResolvedValue({ file: { id: 'f4' }, upload: { mode: 'single', url: 'https://r2/z', headers: {} } });
    vi.stubGlobal('XMLHttpRequest', class extends FakeXhr { send() { /* never finishes */ } });
    const h = uploadFile(file(10), {}, () => undefined);
    await new Promise((r) => setTimeout(r, 10));
    h.cancel();
    await expect(h.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.abort).toHaveBeenCalledWith('f4');
  });
});
