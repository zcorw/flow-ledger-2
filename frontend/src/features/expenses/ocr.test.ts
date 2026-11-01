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
  it('checks real headers, dimensions, type and size before decoding', async () => {
    expect(imageDimensions(pngHeader(1000, 1200))).toEqual({ width: 1000, height: 1200 });
    await expect(validateReceiptImage(file(pngHeader(1000, 1200)))).resolves.toBeUndefined();
    await expect(validateReceiptImage(file(pngHeader(1000, 1200), 'text/plain'))).rejects.toThrow('PNG');
    await expect(validateReceiptImage(file(pngHeader(1000, 1200), 'image/png', MAX_IMAGE_BYTES + 1))).rejects.toThrow('8 MB');
    await expect(validateReceiptImage(file(pngHeader(10000, 10000)))).rejects.toThrow('2000 万');
    await expect(validateReceiptImage(file(new Uint8Array(30)))).rejects.toThrow('格式无效');
  });
});

// Mocked lifecycle/fault tests, separate from the real browser OCR E2E.
describe('OCR lifecycle with a simulated Worker', () => {
  function setup() {
    class FakeWorker {
      static latest: FakeWorker;
      onmessage?: (event: { data: unknown }) => void;
      onerror?: () => void;
      terminate = vi.fn(); postMessage = vi.fn();
      constructor() { FakeWorker.latest = this; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    return FakeWorker;
  }
  it('cancels initialization and ignores late progress and results', async () => {
    const Fake = setup(); const progress = vi.fn();
    const task = recognizeReceipt(new File([], 'synthetic.png'), progress);
    const rejected = expect(task.result).rejects.toThrow('已取消');
    task.cancel(); await rejected;
    Fake.latest.onmessage?.({ data: { type: 'result', text: 'late', confidence: 100 } });
    Fake.latest.onmessage?.({ data: { type: 'progress', progress: 1 } });
    expect(progress).not.toHaveBeenCalled(); expect(Fake.latest.terminate).toHaveBeenCalledOnce();
  });
  it('times out and terminates a stuck worker', async () => {
    vi.useFakeTimers(); const Fake = setup();
    const task = recognizeReceipt(new File([], 'synthetic.png'), vi.fn(), 100);
    const rejected = expect(task.result).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(100); await rejected;
    expect(Fake.latest.terminate).toHaveBeenCalledOnce();
  });
  it('handles missing resources and returns worker output unchanged', async () => {
    const Fake = setup(); const task = recognizeReceipt(new File([], 'synthetic.png'), vi.fn());
    Fake.latest.onerror?.(); await expect(task.result).rejects.toThrow('加载失败');
    const second = recognizeReceipt(new File([], 'synthetic.png'), vi.fn());
    Fake.latest.onmessage?.({ data: { type: 'result', text: '合計 1234円', confidence: 92 } });
    await expect(second.result).resolves.toEqual({ text: '合計 1234円', confidence: 92 });
  });
});
