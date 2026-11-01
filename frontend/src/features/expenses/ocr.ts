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

export type OcrResult = { text: string; confidence: number };
export function recognizeReceipt(file: File, onProgress: (progress: number, status: string) => void,
  timeoutMs = 90_000): { result: Promise<OcrResult>; cancel: () => void } {
  const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  let rejectResult: (error: Error) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => { settled = true; clearTimeout(timer); worker.terminate(); };
  const result = new Promise<OcrResult>((resolve, reject) => {
    rejectResult = reject;
    worker.onmessage = (event: MessageEvent<OcrResult & { type: string; progress: number; status: string; message: string }>) => {
      if (settled) return;
      const data = event.data;
      if (data.type === 'progress') onProgress(Math.round(data.progress * 100), data.status);
      if (data.type === 'result') { finish(); resolve({ text: data.text, confidence: data.confidence }); }
      if (data.type === 'error') { finish(); reject(new Error(data.message)); }
    };
    worker.onerror = () => { if (!settled) { finish(); reject(new Error('OCR 引擎加载失败，可重试或手工录入。')); } };
    timer = setTimeout(() => { finish(); reject(new Error('识别超时，已停止。草稿保留，可换图重试或手工录入。')); }, timeoutMs);
    worker.postMessage({ image: file, resourceRoot: new URL(`${import.meta.env.BASE_URL}ocr`, location.origin).href });
  });
  return { result, cancel: () => { if (!settled) { finish(); rejectResult(new Error('已取消识别，草稿保留。')); } } };
}
