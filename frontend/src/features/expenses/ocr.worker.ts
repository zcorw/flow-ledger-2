// A disposable coordinator owns the Tesseract subworker, including initialization.
// Terminating this worker also terminates its nested workers, even during model loading.
import { createWorker, OEM, PSM } from 'tesseract.js';

self.onmessage = async (event: MessageEvent<{ image: Blob; resourceRoot: string }>) => {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const root = event.data.resourceRoot;
    worker = await createWorker(['jpn', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${root}/worker.min.js`, corePath: `${root}/core`, langPath: `${root}/lang`,
      workerBlobURL: false, cacheMethod: 'none',
      logger: (message) => self.postMessage({ type: 'progress', ...message }),
      errorHandler: () => self.postMessage({ type: 'error', message: '识别资源加载或处理失败，请重试或手工录入。' }),
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    const result = await worker.recognize(event.data.image);
    self.postMessage({ type: 'result', text: result.data.text, confidence: result.data.confidence });
  } catch {
    self.postMessage({ type: 'error', message: '识别失败，请检查图片与同站 OCR 资源，或继续手工录入。' });
  } finally {
    await worker?.terminate();
  }
};
