import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptDevicesPage } from './ReceiptDevicesPage';
import { decidePairing, getPairing, listReceiptDevices, revokeReceiptDevice, setExpensePermission } from './api';
vi.mock('./api', () => ({ decidePairing: vi.fn(), getPairing: vi.fn(), listReceiptDevices: vi.fn(), revokeReceiptDevice: vi.fn(), setExpensePermission: vi.fn() }));
const clients: QueryClient[] = [];
function show(path = '/receipt-devices') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><ReceiptDevicesPage /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.mocked(listReceiptDevices).mockResolvedValue([]);
  vi.mocked(getPairing).mockResolvedValue({ deviceName: 'Rokid', status: 'pending', scope: 'receipt:recognize', expiresAt: '2099-01-01T00:00:00Z' });
  vi.mocked(decidePairing).mockResolvedValue({ status: 'approved' }); vi.mocked(revokeReceiptDevice).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.resetAllMocks(); });
describe('phone device consent', () => {
  it('does not enable accounting from a link and requires a separate explicit acknowledgement', async () => {
    vi.mocked(listReceiptDevices).mockResolvedValue([{ id: 'device-one', deviceName: 'Rokid', scope: 'receipt:recognize', expiresAt: null }]);
    vi.mocked(setExpensePermission).mockResolvedValue({ enabled: true });
    show('/receipt-devices?device=device-one');
    fireEvent.click(await screen.findByRole('button', { name: '允许确认入账' }));
    const approve = await screen.findByRole('button', { name: '确认授权入账' });
    expect(approve).toBeDisabled(); expect(setExpensePermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('我已核对此设备，并允许逐笔确认入账')); fireEvent.click(approve);
    await waitFor(() => expect(setExpensePermission).toHaveBeenCalledWith('device-one', true));
  });
  it('never authorizes from a prefilled code and requires lookup plus explicit acknowledgement', async () => {
    show('/receipt-devices?code=ABCD-EFGH');
    expect(decidePairing).not.toHaveBeenCalled(); expect(getPairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '核对设备' }));
    const approve = await screen.findByRole('button', { name: '授权识别收据' });
    expect(approve).toBeDisabled(); expect(screen.getByText('ABCD-EFGH')).toBeVisible(); expect(decidePairing).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(approve);
    await waitFor(() => expect(decidePairing).toHaveBeenCalledWith('ABCDEFGH', 'approve'));
    expect(await screen.findByText('授权完成，请返回眼镜继续识别。')).toBeVisible();
  });
  it('allows denial without approval and clears the acknowledgement when the code changes', async () => {
    show('/receipt-devices?code=ABCD-EFGH'); fireEvent.click(screen.getByRole('button', { name: '核对设备' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('眼镜授权码'), { target: { value: 'JKLM-NPQR' } });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '核对设备' }));
    expect(await screen.findByRole('button', { name: '授权识别收据' })).toBeDisabled();
    vi.mocked(decidePairing).mockResolvedValue({ status: 'denied' });
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(decidePairing).toHaveBeenCalledWith('JKLMNPQR', 'deny'));
  });
  it('lists and revokes an active receipt-only grant', async () => {
    vi.mocked(listReceiptDevices).mockResolvedValue([{ id: 'device-one', deviceName: 'Rokid', scope: 'receipt:recognize', expiresAt: null }]);
    show(); expect(await screen.findByText('收据识别 · 长期有效')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: '撤销授权' }));
    await waitFor(() => expect(revokeReceiptDevice).toHaveBeenCalledWith('device-one', expect.anything()));
  });
});
