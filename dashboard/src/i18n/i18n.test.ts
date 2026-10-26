import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ar } from './ar';
import { PERMISSIONS } from '@/types';

const flatten = (o: any, p = ''): Record<string, string> =>
  Object.entries(o).reduce((acc, [k, v]) => (typeof v === 'string' ? { ...acc, [p + k]: v } : { ...acc, ...flatten(v, `${p}${k}.`) }), {});

const E = flatten(en);
const A = flatten(ar);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(p) && !/\.test\./.test(p) && !p.includes('/i18n/') ? [p] : [];
  });
}

describe('translations', () => {
  it('Arabic has exactly the same keys as English, none empty', () => {
    expect(Object.keys(A).sort()).toEqual(Object.keys(E).sort());
    expect(Object.entries(A).filter(([, v]) => !v.trim())).toEqual([]);
  });
  it('keeps interpolation placeholders in both languages', () => {
    for (const [k, v] of Object.entries(E)) {
      const ph = (v.match(/\{\{\w+\}\}/g) ?? []).sort();
      expect((A[k].match(/\{\{\w+\}\}/g) ?? []).sort(), k).toEqual(ph);
    }
  });
  it('every static key used in the source exists in English', () => {
    const ns = [...new Set(Object.keys(E).map((k) => k.split('.')[0]))];
    const re = new RegExp(`["'\`]((?:${ns.join('|')})\\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'\`]`, 'g');
    const missing: string[] = [];
    for (const f of walk(join(__dirname, '..'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(re)) {
        const key = m[1];
        const exists = key in E || Object.keys(E).some((k) => k.startsWith(`${key}.`));
        if (!exists && !(PERMISSIONS as readonly string[]).includes(key) && !/^(status|material|roles)\.\$/.test(key)) missing.push(`${f.split('/src/')[1]}: ${key}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
