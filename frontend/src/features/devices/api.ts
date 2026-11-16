import { apiRequest } from '../../api/client';
export type ReceiptPairing = { deviceName: string; status: string; expiresAt: string; scope: string };
export type ReceiptDevice = { id: string; deviceName: string; expiresAt: string | null; scope: string };
export const getPairing = (code: string) => apiRequest<ReceiptPairing>('/receipt-devices/pairings/lookup', { method: 'POST', body: JSON.stringify({ userCode: code }) });
export const decidePairing = (code: string, action: 'approve' | 'deny') => apiRequest<{ status: string }>(`/receipt-devices/pairings/${action}`, { method: 'POST', headers: { 'X-Device-Approval': '1' }, body: JSON.stringify({ userCode: code }) });
export const listReceiptDevices = () => apiRequest<ReceiptDevice[]>('/receipt-devices');
export const revokeReceiptDevice = (id: string) => apiRequest<void>(`/receipt-devices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Device-Approval': '1' } });
