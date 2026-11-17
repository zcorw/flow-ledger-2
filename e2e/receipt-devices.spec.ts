import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('separate phone consent enables one idempotent receipt expense and can be revoked', async ({ page, playwright }) => {
  const setup = await (await page.request.get('/api/v1/setup/status')).json();
  if (setup.requires_setup) await page.request.post('/api/v1/setup/bootstrap', { data: {
    bootstrapToken: 'e2e-bootstrap-token', displayName: 'Synthetic owner', email: 'e2e@example.com', password: 'e2e-password-456',
  } });
  await page.request.post('/api/v1/auth/login', { data: { email: 'e2e@example.com', password: 'e2e-password-456' } });
  const device = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4186' });
  const prefix = '/api/v1/receipt-devices';
  try {
    const pairing = await (await device.post(prefix + '/pairings', { data: { deviceName: 'E2E native confirmation' } })).json();
    await page.request.post(prefix + '/pairings/approve', { headers: { 'X-Device-Approval': '1' }, data: { userCode: pairing.userCode } });
    const grant = await (await device.post(prefix + '/pairings/token', { data: { deviceCode: pairing.deviceCode } })).json();
    const headers = { Authorization: 'Bearer ' + grant.accessToken };
    await page.goto('/receipt-devices?device=' + grant.deviceId);
    await expect(page.getByText('E2E native confirmation', { exact: true })).toBeVisible();
    const before = (await (await page.request.get('/api/v1/expenses')).json()).total;
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 80;
      const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 40, 80);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    // The isolated server has no provider key. Valid original persistence precedes
    // this expected configuration error; no paid recognition is performed.
    const uploaded = await device.post(prefix + '/receipt-recognition', { headers: { ...headers, 'Content-Type': 'image/png', 'X-Receipt-Upload': '1' }, data: Buffer.from(png, 'base64') });
    expect(uploaded.status()).toBe(503);
    const receiptId = (await uploaded.json()).error.details.find((item: { receiptId?: string }) => item.receiptId)?.receiptId;
    expect(receiptId).toBeTruthy();
    const account = await (await page.request.post('/api/v1/accounts', { data: { name: 'E2E confirmation wallet', accountType: 'cash_wallet' } })).json();
    const draft = await device.post(prefix + '/receipt-drafts', { headers, data: {
      receiptId, requestKey: crypto.randomUUID(), expectedRevision: 0,
      values: { amount: '614', expenseDate: '2026-11-17', currencyCode: 'CNY', category: 'food', accountId: account.id, merchant: 'E2E confirmation merchant' },
    } });
    expect(draft.status()).toBe(200);
    const confirmation = { receiptId, revision: 1, requestKey: crypto.randomUUID(), confirmed: true };
    expect((await device.post(prefix + '/receipt-confirmations', { headers, data: confirmation })).status()).toBe(403);
    expect((await (await page.request.get('/api/v1/expenses')).json()).total).toBe(before);
    await page.getByRole('button', { name: '允许确认入账', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '允许设备确认入账' });
    const approve = dialog.getByRole('button', { name: '确认授权入账' });
    await expect(approve).toBeDisabled();
    expect((await (await device.get(prefix + '/capabilities', { headers })).json()).canCreateExpenses).toBe(false);
    await dialog.getByRole('checkbox').check(); await approve.click(); await expect(dialog).not.toBeVisible();
    const created = await device.post(prefix + '/receipt-confirmations', { headers, data: confirmation });
    expect(created.status()).toBe(201);
    const record = (await created.json()).record;
    const repeated = await device.post(prefix + '/receipt-confirmations', { headers, data: confirmation });
    expect((await repeated.json()).record.id).toBe(record.id);
    expect((await (await page.request.get('/api/v1/expenses')).json()).total).toBe(before + 1);
    expect((await page.request.get('/api/v1/receipts/' + receiptId + '/image')).status()).toBe(200);
    await page.getByRole('button', { name: '撤销入账权限' }).click();
    await expect(page.getByRole('button', { name: '允许确认入账' })).toBeVisible();
    expect((await (await device.get(prefix + '/capabilities', { headers })).json()).canCreateExpenses).toBe(false);
    expect((await device.get(prefix + '/receipt-drafts/' + receiptId, { headers })).status()).toBe(200);
    expect((await page.request.delete(prefix + '/' + grant.deviceId, { headers: { 'X-Device-Approval': '1' } })).status()).toBe(204);
  } finally { await device.dispose(); }
});

test('phone login returns to device consent; matching code requires explicit approval and supports revocation', async ({ page, playwright }) => {
  test.setTimeout(90_000);
  const setup = await (await page.request.get('/api/v1/setup/status')).json();
  if (setup.requires_setup) {
    expect((await page.request.post('/api/v1/setup/bootstrap', { data: {
      bootstrapToken: 'e2e-bootstrap-token', displayName: 'Synthetic device owner',
      email: 'e2e@example.com', password: 'e2e-password-456',
    } })).status()).toBe(201);
    await page.context().clearCookies();
  }
  // A separate device context has no browser session or saved credentials.
  const device = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4186' });
  try {
    const prefix = '/api/v1/receipt-devices';
    const started = await device.post(prefix + '/pairings', { data: { deviceName: 'Synthetic Rokid' } });
    expect(started.status()).toBe(201);
    const pairing = await started.json();
    const poll = () => device.post(prefix + '/pairings/token', { data: { deviceCode: pairing.deviceCode } });
    expect((await poll()).status()).toBe(202);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/receipt-devices?code=' + pairing.userCode);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page).toHaveTitle('知产');
    await expect(page.getByRole('heading', { name: '登录知产' })).toBeVisible();
    const brand = page.locator('img[src="/brand/zhichan.svg"]').first();
    await expect(brand).toBeVisible();
    await expect.poll(() => brand.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('zhichan-login-mobile.png'), fullPage: true });
    await page.getByLabel('邮箱地址').fill('e2e@example.com');
    await page.getByLabel('密码', { exact: true }).fill('e2e-password-456');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL(/\/receipt-devices\?code=/);
    await expect(page.getByRole('heading', { level: 1, name: '设备授权', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '核对设备' }).click();
    await expect(page.getByText('Synthetic Rokid', { exact: true })).toBeVisible();
    const approve = page.getByRole('button', { name: '授权识别收据' });
    await expect(approve).toBeDisabled();
    await page.waitForTimeout(3100);
    expect((await poll()).status()).toBe(202);
    await page.getByRole('checkbox', { name: '我已核对，授权码与眼镜显示一致' }).check();
    await expect(approve).toBeEnabled();
    // Scan the enabled state after its CSS color transitions have finished.
    await approve.evaluate(async element => {
      await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    });

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
    await approve.click();
    await expect(page.getByText('授权完成，请返回眼镜继续识别。')).toBeVisible();
    const exchanged = await poll(); expect(exchanged.status()).toBe(200);
    const grant = await exchanged.json(); expect(grant.scope).toBe('receipt:recognize'); expect(grant.expiresAt).toBeNull();
    expect((await device.get('/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + grant.accessToken } })).status()).toBe(401);
    await page.reload();
    await expect(page.getByText('收据识别 · 长期有效')).toBeVisible();
    await page.getByRole('button', { name: '撤销授权' }).click();
    await expect(page.getByText('暂无有效设备授权。')).toBeVisible();
    const denied = await device.post(prefix + '/receipt-recognition', { headers: { Authorization: 'Bearer ' + grant.accessToken, 'X-Receipt-Upload': '1', 'Content-Type': 'image/png' }, data: Buffer.from('synthetic') });
    expect(denied.status()).toBe(401);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('link', { name: '返回设置' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '设置', exact: true })).toBeVisible();
      await page.getByRole('link', { name: '管理设备授权' }).click();
      await expect(page).toHaveURL(/\/receipt-devices$/);
      await expect(page.getByRole('heading', { level: 1, name: '设备授权', exact: true })).toBeVisible();
      if (viewport.width >= 900) {
        const navigation = page.getByRole('navigation', { name: '主要导航' });
        await expect(navigation.getByRole('button', { name: '设备授权', exact: true })).toHaveCount(0);
        await expect(navigation.getByRole('button', { name: '设置', exact: true })).toHaveAttribute('aria-current', 'page');
      }
      await page.screenshot({ path: test.info().outputPath(`devices-${viewport.width}.png`), fullPage: true });
    }
  } finally { await device.dispose(); }
});
