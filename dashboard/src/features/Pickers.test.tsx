import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { ColorPicker, type PantoneChoice } from './Pickers';
import type { BaseColor } from '@/types';

vi.mock('@/services/api', () => ({ res: { pantone: { list: vi.fn().mockResolvedValue({ items: [], meta: {} }) }, clients: { list: vi.fn() } } }));

function Harness({ includePantone = false, initialPantone = [] as PantoneChoice[] }) {
  const [base, setBase] = useState<BaseColor[]>([]);
  const [pantone, setPantone] = useState<PantoneChoice[]>(initialPantone);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ColorPicker base={base} pantone={pantone} onBase={setBase} onPantone={setPantone} includePantone={includePantone} />
    </QueryClientProvider>
  );
}

describe('ColorPicker', () => {
  it('derives the colors count and supports the All control', () => {
    render(<Harness />);
    const count = screen.getByLabelText('Colors Count') as HTMLInputElement;
    expect(count.value).toBe('0');
    expect(count).toHaveAttribute('readonly');
    fireEvent.click(screen.getByLabelText('C'));
    fireEvent.click(screen.getByLabelText('K'));
    expect(count.value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(count.value).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(count.value).toBe('0');
  });
  it('counts Pantone colors only when the business rule says so', () => {
    const p = [{ code: 'PANTONE 185 C' }, { code: 'PANTONE 286 C' }];
    const { unmount } = render(<Harness initialPantone={p} />);
    fireEvent.click(screen.getByLabelText('M'));
    expect((screen.getByLabelText('Colors Count') as HTMLInputElement).value).toBe('1');
    unmount();
    render(<Harness includePantone initialPantone={p} />);
    fireEvent.click(screen.getByLabelText('M'));
    expect((screen.getByLabelText('Colors Count') as HTMLInputElement).value).toBe('3');
  });
  it('removes a selected Pantone color', () => {
    render(<Harness initialPantone={[{ code: 'PANTONE 185 C' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('PANTONE 185 C')).toBeNull();
  });
});
