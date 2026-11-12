import { apiRequest } from '../../api/client';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;

export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)
    && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset += 1; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 7) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += length + 2;
    }
  }
  throw new Error('图片格式无效，请选择有效的 PNG 或 JPEG 图片。');
}

export async function validateReceiptImage(file: File): Promise<void> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('仅支持 PNG、JPEG 图片。');
  if (file.size > MAX_IMAGE_BYTES || !file.size) throw new Error('图片须为 1 字节至 8 MB。');
  const { width, height } = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!width || !height || width > 10000 || height > 10000 || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('图片须不超过 2000 万像素，且单边不超过 10000 像素。');
  }
}

export type ReceiptCandidate = {
  amount: string; expenseDate: string; currencyCode: string; merchant: string; warnings: string[];
};
export const getReceiptStatus = () => apiRequest<{ configured: boolean; model: string }>('/expenses/receipt-recognition');

export function recognizeReceipt(file: File, onProgress: (progress: number, status: string) => void,
  timeoutMs = 60_000): { result: Promise<ReceiptCandidate>; cancel: () => void } {
  const controller = new AbortController();
  let rejectResult: (error: Error) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => { settled = true; clearTimeout(timer); };
  const result = new Promise<ReceiptCandidate>((resolve, reject) => {
    rejectResult = reject;
    timer = setTimeout(() => {
      finish(); controller.abort();
      reject(new Error('识别超时，未自动重试；草稿保留。已发送的请求仍可能计费。'));
    }, timeoutMs);
    onProgress(0, '正在发送图片并等待 AI 识别');
    void apiRequest<ReceiptCandidate>('/expenses/receipt-recognition', {
      method: 'POST', body: file, signal: controller.signal,
      headers: { 'Content-Type': file.type, 'X-Receipt-Upload': '1' },
    }).then((candidate) => {
      if (!settled) { finish(); resolve(candidate); }
    }, (error: unknown) => {
      if (!settled) { finish(); reject(error); }
    });
  });
  return { result, cancel: () => {
    if (!settled) {
      finish(); controller.abort();
      rejectResult(new Error('已取消等待，草稿保留。已发送的请求仍可能计费。'));
    }
  } };
}
