import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageDimensions, MAX_IMAGE_BYTES, recognizeReceipt, validateReceiptImage } from './ocr';

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function file(bytes: Uint8Array, type = 'image/png', size = bytes.length) {
  return { type, size, arrayBuffer: async () => bytes.buffer } as File;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('receipt admission', () => {
  it('checks headers, dimensions, type and size before upload', async () => {
    expect(imageDimensions(pngHeader(1000, 1200))).toEqual({ width: 1000, height: 1200 });
    await expect(validateReceiptImage(file(pngHeader(1000, 1200)))).resolves.toBeUndefined();
    await expect(validateReceiptImage(file(pngHeader(1000, 1200), 'text/plain'))).rejects.toThrow('PNG');
    await expect(validateReceiptImage(file(pngHeader(1000, 1200), 'image/png', MAX_IMAGE_BYTES + 1))).rejects.toThrow('8 MB');
    await expect(validateReceiptImage(file(pngHeader(10000, 10000)))).rejects.toThrow('2000 万');
    await expect(validateReceiptImage(file(new Uint8Array(30)))).rejects.toThrow('格式无效');
  });
});

describe('receipt recognition with simulated HTTP', () => {
  const candidate = { amount: '1234', expenseDate: '2026-11-01', currencyCode: 'JPY', merchant: '合成商店', warnings: [] };
  it('sends one authenticated image request and preserves decimal text', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => candidate });
    vi.stubGlobal('fetch', fetch);
    const image = new File(['synthetic'], 'private-filename.png', { type: 'image/png' });
    await expect(recognizeReceipt(image, vi.fn()).result).resolves.toEqual(candidate);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/expenses/receipt-recognition');
    expect(init.body).toBe(image); expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ 'Content-Type': 'image/png', 'X-Receipt-Upload': '1' });
  });
  it('aborts cancellation, ignores late results and never retries', async () => {
    let respond!: (response: unknown) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetch);
    const task = recognizeReceipt(new File([], 'synthetic.png'), vi.fn());
    const rejected = expect(task.result).rejects.toThrow('已取消');
    task.cancel(); await rejected;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    respond({ ok: true, status: 200, json: async () => candidate });
    await Promise.resolve(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('aborts timeouts and states sent work can still be billed', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetch);
    const task = recognizeReceipt(new File([], 'synthetic.png'), vi.fn(), 100);
    const rejected = expect(task.result).rejects.toThrow('仍可能计费');
    await vi.advanceTimersByTimeAsync(100); await rejected;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('preserves server errors without fallback calls', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { code: 'RECEIPT_RATE_LIMIT', message: '识别次数过多' } }) });
    vi.stubGlobal('fetch', fetch);
    await expect(recognizeReceipt(new File([], 'synthetic.png'), vi.fn()).result).rejects.toThrow('识别次数过多');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
