import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const evidence = path.resolve('test-results/expense-evidence');
const receiptModel = 'gpt-6-sol';
async function login(page: Page) {
  const state = await (await page.request.get('/api/v1/setup/status')).json();
  if (state.requires_setup) {
    expect((await page.request.post('/api/v1/setup/bootstrap', { data: {
      bootstrapToken: 'e2e-bootstrap-token', displayName: '合成测试管理员',
      email: 'e2e@example.com', password: 'e2e-password-456',
    } })).status()).toBe(201);
  } else {
    expect((await page.request.post('/api/v1/auth/login', { data: {
      email: 'e2e@example.com', password: 'e2e-password-456',
    } })).status()).toBe(200);
  }
  // Browser integration uses synthetic, mocked recognition; never a paid model call.
  await page.route('**/api/v1/expenses/receipt-recognition', (route) => route.fulfill({
    json: route.request().method() === 'GET' ? { configured: true, model: receiptModel } : {
      amount: '1234', expenseDate: '2026-11-01', currencyCode: 'JPY',
      merchant: '合成スーパー', warnings: ['请对照原图核对后保存。'],
    },
  }));
  await page.goto('/expenses');
  await expect(page.getByRole('heading', { name: '每日开销', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选' }).click();
}

async function receipt(page: Page, blank = false, commaTotal = false): Promise<Buffer> {
  const data = await page.evaluate(({ isBlank, comma }) => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 1200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 1200); ctx.fillStyle = '#111';
    ctx.font = '42px "Yu Gothic", "Meiryo", sans-serif';
    if (!isBlank) [
      '合成スーパー', '領収書', '2026年11月01日', 'お茶                  200円',
      '食品                  943円', '小計                1,143円',
      comma ? '合計（税込）        1,234円' : '合計（税込）         1234円', '内消費税               91円',
      'お預り              2,000円', 'お釣り                766円', '合成テスト用・実取引なし',
    ].forEach((line, i) => ctx.fillText(line, 60, 90 + i * 90));
    return canvas.toDataURL('image/png').split(',')[1];
  }, { isBlank: blank, comma: commaTotal });
  return Buffer.from(data, 'base64');
}

test('daily expenses CRUD, exact currencies, mocked OpenAI candidate, desktop and mobile', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  await login(page);
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '记录开销' });
  await expect(dialog.getByText(`当前识别模型：${receiptModel}`, { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('45.123456');
  await dialog.getByLabel('消费日期').fill('2026-11-01');
  await dialog.getByRole('combobox', { name: '币种', exact: true }).click();
  await page.getByRole('option', { name: /CNY/ }).click();
  await dialog.getByLabel('消费分类').click(); await page.getByRole('option', { name: '交通', exact: true }).click();
  await dialog.getByLabel('商户（可选）').fill('合成交通');
  await dialog.getByRole('button', { name: '返回（保留草稿）' }).click();
  await page.getByRole('button', { name: '继续草稿' }).click();
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('45.123456');
  let attempts = 0;
  const keys: string[] = [];
  await page.route('**/api/v1/expenses', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().postDataJSON().requestKey);
    attempts += 1;
    if (attempts === 1) {
      // Simulate a lost response AFTER the real API committed. Retry must replay it.
      const result = await route.fetch(); expect(result.status()).toBe(201);
      return route.abort('failed');
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: '确认保存', exact: true }).evaluate((button) => { button.click(); button.click(); });
  await expect(dialog.getByRole('alert')).toContainText('草稿已保留');
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('45.123456');
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(keys[0]).toBe(keys[1]);
  await page.unroute('**/api/v1/expenses');
  expect((await (await page.request.get('/api/v1/expenses')).json()).items.filter((row: { merchant: string }) => row.merchant === '合成交通')).toHaveLength(1);

  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const png = await receipt(page); await writeFile(path.join(evidence, 'synthetic-japanese-receipt.png'), png);
  const outgoing: string[] = [];
  page.on('request', (request) => outgoing.push(request.url()));
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('1234', { timeout: 90_000 });
  await expect(dialog.getByLabel('消费日期')).toHaveValue('2026-11-01');
  await expect(dialog.getByRole('combobox', { name: '币种', exact: true })).toContainText('JPY');
  await expect(dialog.getByLabel('消费分类')).toContainText('未分类');
  await expect(dialog.getByRole('button', { name: '确认保存', exact: true })).toBeDisabled();
  await writeFile(path.join(evidence, 'ocr-request-urls.json'), JSON.stringify(outgoing, null, 2));
  expect(outgoing.every((url) => url.startsWith('http://127.0.0.1:4186/') || url.startsWith('blob:http://127.0.0.1:4186/'))).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'desktop-ocr-review.png'), fullPage: true });
  await dialog.getByLabel('商户（可选）').fill('合成スーパー');
  await dialog.getByLabel('消费分类').click(); await page.getByRole('option', { name: '日用食品', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  const saveRequest = page.waitForRequest((r) => r.url().endsWith('/api/v1/expenses') && r.method() === 'POST');
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  const body = (await saveRequest).postDataJSON();
  expect(body.source).toBe('receipt_ocr'); expect(body.amount).toBe('1234');
  expect(Object.keys(body)).not.toContain('image'); expect(Object.keys(body)).not.toContain('text');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('table').getByText('JPY 1,234', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByText('CNY 45.123456', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'desktop-expenses.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await page.getByRole('button', { name: '编辑开销 合成交通' }).filter({ visible: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑开销' });
  await edit.getByRole('textbox', { name: '金额', exact: true }).fill('50.123456');
  await edit.getByRole('button', { name: '保存修改' }).click(); await expect(edit).not.toBeVisible();
  await page.getByRole('button', { name: '删除开销 合成交通' }).filter({ visible: true }).click();
  const remove = page.getByRole('dialog', { name: '删除这笔开销？' });
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('table').getByText('CNY 50.123456', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#main-content').focus();
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'mobile-expenses.png'), fullPage: true });
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('250');
  await dialog.getByLabel('商户（可选）').fill('合成モバイル');
  await dialog.getByLabel('消费日期').fill('2026-11-01');
  await page.screenshot({ path: path.join(evidence, 'mobile-expense-form.png'), fullPage: true });
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '删除开销 合成モバイル' }).filter({ visible: true }).click();
  await remove.getByRole('button', { name: '确认删除' }).click(); await expect(remove).not.toBeVisible();
  await expect(page.getByText('合成モバイル', { exact: true })).toHaveCount(0);
});

test('mocked API failure, cancellation, close/reopen and unrelated image preserve draft', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '记录开销' });
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('678');
  const png = await receipt(page);
  const image = { name: 'synthetic.png', mimeType: 'image/png', buffer: png };
  let attempt = 0;
  await page.route('**/api/v1/expenses/receipt-recognition', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { configured: true, model: receiptModel } });
    attempt += 1;
    if (attempt === 1) return route.fulfill({ status: 502, json: { error: { code: 'RECEIPT_CONNECTION', message: '无法连接识别服务' } } });
    if (attempt === 2) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return route.fulfill({ json: { amount: '9999', expenseDate: '2026-11-01', currencyCode: 'JPY', merchant: 'late', warnings: [] } }).catch(() => {});
    }
    return route.fulfill({ status: 422, json: { error: { code: 'RECEIPT_NOT_FOUND', message: '未识别到单张有效票据' } } });
  });
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles(image);
  await expect(dialog.getByRole('alert').filter({ hasText: '无法连接' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('678');
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles(image);
  await expect.poll(() => attempt).toBe(2);
  await dialog.getByRole('button', { name: '取消识别' }).click();
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('679');
  await dialog.getByRole('button', { name: '返回（保留草稿）' }).click();
  await page.getByRole('button', { name: '继续草稿' }).click();
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('679');
  const blank = await receipt(page, true);
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(dialog.getByRole('alert').filter({ hasText: '未识别到单张有效票据' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('679');
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
  await expect(dialog.getByRole('alert').filter({ hasText: '仅支持 PNG' })).toBeVisible();
});

test('uncertain mocked candidate requires correction then explicit duplicate confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(evidence, { recursive: true });
  await login(page);
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '记录开销' });
  await page.route('**/api/v1/expenses/receipt-recognition', (route) => route.fulfill({ json:
    route.request().method() === 'GET' ? { configured: true, model: receiptModel } : {
      amount: '', expenseDate: '2026-11-01', currencyCode: 'JPY', merchant: '合成スーパー',
      warnings: ['金额不明确，请手工填写。'],
    },
  }));
  const png = await receipt(page, false, true);
  await writeFile(path.join(evidence, 'synthetic-japanese-comma-receipt.png'), png);
  await dialog.getByLabel('选择票据图片并发送识别').setInputFiles({ name: 'comma-total.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByRole('checkbox')).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByRole('textbox', { name: '金额', exact: true })).toHaveValue('');
  await expect(dialog.getByText('金额不明确，请手工填写。')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'desktop-ocr-uncertain.png'), fullPage: true });
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('1234');
  await dialog.getByLabel('消费日期').fill('2026-11-01');
  await dialog.getByLabel('商户（可选）').fill('合成スーパー');
  await dialog.getByRole('checkbox').check();
  await page.screenshot({ path: path.join(evidence, 'desktop-ocr-correction.png'), fullPage: true });
  await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
  await expect(dialog.getByText('同日存在相同币种、金额和商户的记录，请核对后确认仍保存', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: '确认仍保存' }).click();
  await expect(dialog).not.toBeVisible();
  const data = await (await page.request.get('/api/v1/expenses?currency=JPY')).json();
  expect(data.items.filter((row: { merchant: string; amount: string }) => row.merchant === '合成スーパー' && row.amount === '1234.000000')).toHaveLength(2);
});

test('mobile touch browser records, filters and deletes an expense', async ({ browser, page }) => {
  await login(page);
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4186', viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 1, timezoneId: 'Asia/Tokyo',
    storageState: await page.context().storageState(),
  });
  try {
    const phone = await context.newPage();
    await phone.goto('/expenses');
    await phone.getByRole('button', { name: '清空筛选' }).tap();
    await phone.getByRole('button', { name: '记一笔', exact: true }).tap();
    const dialog = phone.getByRole('dialog', { name: '记录开销' });
    const status = await (await phone.request.get('/api/v1/expenses/receipt-recognition')).json();
    await expect(dialog.getByText(`当前识别模型：${status.model}`, { exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('125');
    await dialog.getByLabel('商户（可选）').fill('合成タッチ');
    await dialog.getByLabel('消费日期').fill('2026-11-01');
    await dialog.getByLabel('消费分类').tap();
    await phone.getByRole('option', { name: '餐饮', exact: true }).tap();
    await expect(phone.getByRole('listbox')).not.toBeVisible();
    await dialog.screenshot({ path: path.join(evidence, 'mobile-expense-form.png') });
    await dialog.getByRole('button', { name: '确认保存', exact: true }).tap();
    await expect(dialog).not.toBeVisible();
    await phone.getByLabel('筛选币种').tap();
    await phone.getByRole('option', { name: 'CNY', exact: true }).tap();
    await expect(phone.getByText('合成タッチ', { exact: true })).toHaveCount(0);
    await phone.getByRole('button', { name: '清空筛选' }).tap();
    await expect(phone.getByText('合成タッチ', { exact: true }).filter({ visible: true })).toBeVisible();
    await phone.locator('#main-content').focus(); await phone.evaluate(() => window.scrollTo(0, 0));
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page: phone }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
    await phone.locator('#main-content').focus(); await phone.evaluate(() => window.scrollTo(0, 0));
    await phone.screenshot({ path: path.join(evidence, 'mobile-expenses.png'), fullPage: true });
    await phone.getByRole('button', { name: '删除开销 合成タッチ' }).tap();
    await phone.getByRole('dialog', { name: '删除这笔开销？' }).getByRole('button', { name: '确认删除' }).tap();
    await expect(phone.getByText('合成タッチ', { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('unconfigured real backend disables uploads and preserves manual entry', async ({ page }) => {
  await login(page);
  await page.unroute('**/api/v1/expenses/receipt-recognition');
  await page.reload();
  const status = await (await page.request.get('/api/v1/expenses/receipt-recognition')).json();
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '记录开销' });
  await expect(dialog.getByText('收据识别尚未配置，请联系管理员或手工录入。')).toBeVisible();
  await expect(dialog.getByText(`当前识别模型：${status.model}`, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('选择票据图片并发送识别')).toBeDisabled();
  await expect(dialog.getByText('选择图片后，将通过服务器发送给 OpenAI 识别，并产生 API 费用。', { exact: false })).toBeVisible();
  await dialog.getByRole('textbox', { name: '金额', exact: true }).fill('10');
  await expect(dialog.getByRole('button', { name: '确认保存', exact: true })).toBeEnabled();
});
