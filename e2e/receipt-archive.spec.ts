import { expect, test } from '@playwright/test';

test('archived receipt opens its private original and carries the link only after explicit expense confirmation', async ({ page }) => {
  const setup = await (await page.request.get('/api/v1/setup/status')).json();
  if (setup.requires_setup) await page.request.post('/api/v1/setup/bootstrap', { data: {
    bootstrapToken: 'e2e-bootstrap-token', displayName: 'Synthetic owner', email: 'e2e@example.com', password: 'e2e-password-456',
  } });
  await page.request.post('/api/v1/auth/login', { data: { email: 'e2e@example.com', password: 'e2e-password-456' } });
  const id = 'e4f82d1a-00d4-40d3-a25c-302f55d1f331';
  const receipt = { id, createdAt: '2026-11-17T00:00:00Z', status: 'recognized', mimeType: 'image/png', byteLength: 68,
    sha256: 'synthetic', expenseId: null, amount: '1234', expenseDate: '2026-11-17', currencyCode: 'JPY', merchant: '合成归档商户', warnings: [], failureCode: '' };
  // UI transport fixtures only. Server tests separately verify actual binary persistence and ownership.
  await page.route('**/api/v1/receipts?*', route => route.fulfill({ json: { items: [receipt], total: 1 } }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6V0AAAAASUVORK5CYII=', 'base64');
  await page.route(`**/api/v1/receipts/${id}/image`, route => route.fulfill({ body: png, contentType: 'image/png' }));
  let saved: Record<string, unknown> | undefined;
  await page.route('**/api/v1/expenses', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    saved = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: { ...saved, id: 'synthetic-expense' } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/receipts');
  await expect(page.getByText('合成归档商户')).toBeVisible();
  await page.getByRole('button', { name: '查看原图', exact: true }).click();
  const image = page.getByRole('img', { name: '单据原图', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('link', { name: '记录开销' }).click();
  const dialog = page.getByRole('dialog', { name: '记录开销' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('商户（可选）')).toHaveValue('合成归档商户');
  await expect(dialog.getByRole('button', { name: '确认保存', exact: true })).toBeDisabled();
  expect(saved).toBeUndefined();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saved?.receiptId).toBe(id); expect(saved?.source).toBe('receipt_ocr');
  expect(saved?.amount).toBe('1234');
});
