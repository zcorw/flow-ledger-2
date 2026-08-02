import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const manifestPath = new URL('../frontend/dist/.vite/manifest.json', import.meta.url);
const distRoot = new URL('../frontend/dist/', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const budgets = [
  {
    name: 'initial application',
    maxGzipKiB: 100,
    chunk: Object.values(manifest).find((entry) => entry.isEntry),
  },
  {
    name: 'dashboard route',
    maxGzipKiB: 220,
    chunk: Object.entries(manifest).find(([key]) => key.endsWith('/DashboardPage.tsx'))?.[1],
  },
  {
    name: 'snapshot route',
    maxGzipKiB: 160,
    chunk: Object.entries(manifest).find(([key]) => key.endsWith('/SnapshotPage.tsx'))?.[1],
  },
];

let failed = false;
for (const budget of budgets) {
  if (!budget.chunk) {
    throw new Error(`Unable to locate ${budget.name} in the Vite manifest`);
  }
  const source = await readFile(new URL(budget.chunk.file, distRoot));
  const gzipKiB = gzipSync(source).byteLength / 1024;
  const passed = gzipKiB <= budget.maxGzipKiB;
  failed ||= !passed;
  console.log(
    `${passed ? 'PASS' : 'FAIL'} ${budget.name}: ${gzipKiB.toFixed(2)} KiB gzip / ${budget.maxGzipKiB} KiB`,
  );
}

if (failed) process.exitCode = 1;
