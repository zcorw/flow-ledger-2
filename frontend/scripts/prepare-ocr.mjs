// Copy only locked npm package resources; the browser never executes CDN scripts.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { URL } from 'node:url';
import { log } from 'node:console';

const require = createRequire(import.meta.url);
const root = new URL('../public/ocr/', import.meta.url);
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
await mkdir(new URL('core/', root), { recursive: true });
await mkdir(new URL('lang/', root), { recursive: true });
await copyFile(require.resolve('tesseract.js/dist/worker.min.js'), new URL('worker.min.js', root));
for (const name of await readdir(coreDir)) {
  if (name.endsWith('.wasm.js') || name.endsWith('.wasm')) {
    await copyFile(join(coreDir, name), new URL(`core/${name}`, root));
  }
}
for (const lang of ['jpn', 'eng']) {
  const packageDir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  await copyFile(join(packageDir, `4.0.0_best_int/${lang}.traineddata.gz`),
    new URL(`lang/${lang}.traineddata.gz`, root));
}
log('Prepared same-origin OCR worker, WASM cores, and jpn/eng models from locked packages.');
