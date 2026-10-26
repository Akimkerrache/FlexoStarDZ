import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';

const api = vi.hoisted(() => ({
  orders: { create: vi.fn(), update: vi.fn(), list: vi.fn(), reorder: vi.fn() },
  res: {
    machines: { list: vi.fn() }, options: { list: vi.fn() }, clients: { list: vi.fn() }, pantone: { list: vi.fn() },
  },
  settings: { get: vi.fn() },
  files: {},
}));
vi.mock('@/services/api', () => api);

import OrderForm from './OrderForm';
import { useAuth } from '@/stores';
import type { User } from '@/types';

const user = (role: User['role'], extra: Partial<User> = {}): User => ({ id: 'u1', name: 'Test', email: 't@t.dz', role, isActive: true, clientId: null, printerId: null, permissions: [], mustChangePassword: false, language: 'en', ...extra });

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/orders/new']}>
        <Routes>
          <Route path="/orders/new" element={<OrderForm />} />
          <Route path="/orders/:id" element={<p>order details page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const page = (items: any[]) => ({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });
  api.res.machines.list.mockResolvedValue(page([{ id: 'm1', name: 'Flexo 8', code: 'FX-8', printWidthMm: 1000, maxColors: 8 }]));
  api.res.options.list.mockResolvedValue(page([]));
  api.res.pantone.list.mockResolvedValue(page([]));
  api.res.clients.list.mockResolvedValue(page([{ id: 'c1', legalName: 'Café SARL', code: 'CLI-00001' }]));
  api.settings.get.mockResolvedValue({ jobNameRejectArabic: true, colorCountIncludesPantone: false, storageConfigured: true, maxUploadSizeMb: 1024 });
  api.orders.create.mockResolvedValue({ id: 'o1', jobCode: '260000001' });
});

const fillValid = async () => {
  await waitFor(() => expect(screen.getByRole('option', { name: /Flexo 8/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Machine/), { target: { value: 'm1' } });
  fireEvent.change(screen.getByLabelText(/Job Name/), { target: { value: 'Coffee bag' } });
  fireEvent.click(screen.getByLabelText('Surface'));
  fireEvent.click(screen.getAllByLabelText('Transparent')[0]);
};

describe('OrderForm (staff)', () => {
  beforeEach(() => useAuth.setState({ user: user('admin'), status: 'authed' }));

  it('requires a client selected from the search list', async () => {
    renderForm();
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    expect((await screen.findAllByText('Please select a client from the search list.')).length).toBeGreaterThan(0);
    expect(api.orders.create).not.toHaveBeenCalled();
  });

  it('typing free text without choosing a result does not count as a client', async () => {
    renderForm();
    await fillValid();
    fireEvent.change(screen.getByPlaceholderText('Search Client…'), { target: { value: 'Caf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    expect((await screen.findAllByText('Please select a client from the search list.')).length).toBeGreaterThan(0);
    expect(api.orders.create).not.toHaveBeenCalled();
  });

  it('submits with the selected client, structured specs and an idempotency key', async () => {
    renderForm();
    await fillValid();
    fireEvent.focus(screen.getByPlaceholderText('Search Client…'));
    fireEvent.click(await screen.findByText('Café SARL'));
    fireEvent.click(screen.getByLabelText('M'));
    fireEvent.click(screen.getByLabelText('Logo'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    await waitFor(() => expect(api.orders.create).toHaveBeenCalledTimes(1));
    const [body, key] = api.orders.create.mock.calls[0];
    expect(body).toMatchObject({ clientId: 'c1', machineId: 'm1', jobName: 'Coffee bag', submit: true });
    expect(body.technicalSpecifications).toMatchObject({
      printDirection: 'surface', printMaterial: 'transparent', printOptions: { linesGuides: true, logo: true }, colors: { base: ['M'], pantone: [] }, barcode: { enabled: false },
    });
    expect(key).toMatch(/.{8,}/);
    expect(await screen.findByText('order details page')).toBeInTheDocument();
  });

  it('rejects Arabic letters in the job name only', async () => {
    renderForm();
    await fillValid();
    fireEvent.change(screen.getByLabelText(/Job Name/), { target: { value: 'قهوة' } });
    fireEvent.change(screen.getByLabelText(/Customer Notes/), { target: { value: 'ملاحظات' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    await waitFor(() => expect(screen.getAllByText('No Arabic letters').some((e) => e.getAttribute('role') === 'alert')).toBe(true));
    expect(api.orders.create).not.toHaveBeenCalled();
  });

  it('shows server-side field errors on the right inputs', async () => {
    const { ApiError } = await import('@/services/http');
    api.orders.create.mockRejectedValue(new ApiError(422, 'INVALID_REFERENCE', 'Selected machine does not exist', [{ field: 'machineId', message: 'Invalid machine' }]));
    renderForm();
    await fillValid();
    fireEvent.focus(screen.getByPlaceholderText('Search Client…'));
    fireEvent.click(await screen.findByText('Café SARL'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    expect(await screen.findByText('Invalid machine')).toBeInTheDocument();
  });
});

describe('OrderForm (client)', () => {
  beforeEach(() => useAuth.setState({ user: user('client', { clientId: 'c1' }), status: 'authed' }));

  it('locks the client and never sends clientId', async () => {
    renderForm();
    const input = await screen.findByPlaceholderText('Search Client…');
    await waitFor(() => expect(input).toHaveValue('Café SARL'));
    expect(input).toBeDisabled();
    await fillValid();
    expect(screen.queryByLabelText(/Internal notes/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    await waitFor(() => expect(api.orders.create).toHaveBeenCalled());
    expect(api.orders.create.mock.calls[0][0]).not.toHaveProperty('clientId');
    expect(api.orders.create.mock.calls[0][0]).not.toHaveProperty('internalNotes');
  });
});
