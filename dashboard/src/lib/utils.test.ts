import { describe, expect, it } from 'vitest';
import { ARABIC_RE, fmtBytes, fromMinor, money, toDateInput, toMinor, toggleAllBaseColors } from './utils';
import { previewTotals, linesValid, emptyLine } from '@/features/LineItems';

describe('base color "All" control', () => {
  it('selects everything, then clears when everything is selected', () => {
    expect(toggleAllBaseColors([])).toEqual(['C', 'M', 'Y', 'K', 'W']);
    expect(toggleAllBaseColors(['C'])).toEqual(['C', 'M', 'Y', 'K', 'W']);
    expect(toggleAllBaseColors(['C', 'M', 'Y', 'K', 'W'])).toEqual([]);
  });
});

describe('job name rule', () => {
  it('detects Arabic script only', () => {
    expect(ARABIC_RE.test('قهوة')).toBe(true);
    expect(ARABIC_RE.test('Coffee 5kg')).toBe(false);
  });
});

describe('formatting', () => {
  it('converts money without float drift', () => {
    expect(toMinor('19.99')).toBe(1999);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(fromMinor(1999)).toBe('19.99');
    expect(money(123456, 'DZD')).toBe('1,234.56 DZD');
    expect(money(undefined)).toBe('—');
  });
  it('formats bytes and dates', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(toDateInput('2026-10-26T10:00:00.000Z')).toBe('2026-10-26');
  });
});

describe('line item preview', () => {
  it('mirrors server arithmetic (preview only)', () => {
    const l = { ...emptyLine(), description: 'x', quantity: '3', unitPrice: '10', discountPercent: '10', taxPercent: '19' };
    expect(previewTotals([l])).toEqual({ sub: 3000, disc: 300, tax: 513, total: 3213 });
    expect(linesValid([l])).toBe(true);
    expect(linesValid([{ ...l, description: ' ' }])).toBe(false);
    expect(linesValid([])).toBe(false);
  });
});
