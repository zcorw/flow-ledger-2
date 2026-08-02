import { expect, test } from '@playwright/test';

test('initializes, records an asset snapshot, verifies the dashboard, and logs out', async ({
  context,
  page,
}) => {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: '初始化管理员' })).toBeVisible();
  await page.getByLabel('Bootstrap Token').fill('e2e-bootstrap-token');
  await page.getByLabel('显示名称').fill('E2E Admin');
  await page.getByLabel('管理员邮箱').fill('e2e@example.com');
  await page.getByLabel('设置密码').fill('e2e-password-123');
  const bootstrapResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/setup/bootstrap'),
  );
  await page.getByRole('button', { name: '创建管理员并初始化' }).click();
  const bootstrapResponse = await bootstrapResponsePromise;
  expect(bootstrapResponse.status()).toBe(201);
  await expect
    .poll(async () =>
      (await context.cookies()).some((cookie) => cookie.name === 'flow_ledger_session'),
    )
    .toBe(true);
  await expect(
    page.getByRole('heading', { level: 4, name: '首页看板', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '机构与账户' }).click();
  await expect(
    page.getByRole('heading', { level: 4, name: '机构与账户', exact: true }),
  ).toBeVisible();
  const addButtons = page.getByRole('button', { name: '新增' });
  await addButtons.nth(0).click();
  await page.getByRole('dialog').getByLabel('名称').fill('E2E Bank');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Bank', { exact: true })).toBeVisible();
  await page.getByText('E2E Bank', { exact: true }).click();

  await addButtons.nth(1).click();
  await page.getByRole('dialog').getByLabel('名称').fill('E2E Account');
  await page.getByRole('dialog').getByLabel('脱敏标识').fill('尾号 2468');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Account', { exact: true })).toBeVisible();
  await page.getByText('E2E Account', { exact: true }).click();

  await addButtons.nth(2).click();
  await page.getByRole('dialog').getByLabel('名称').fill('E2E Balance');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Balance', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '月度快照' }).click();
  await page.getByLabel('快照日期').fill('2026-07-31');
  const assetRow = page.getByRole('row').filter({ hasText: 'E2E Balance' });
  await expect(assetRow).toBeVisible();
  const amountCell = assetRow.getByRole('gridcell').nth(5);
  await amountCell.dblclick();
  await amountCell.getByRole('spinbutton').fill('12345.67');
  await amountCell.getByRole('spinbutton').press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('月度快照已保存')).toBeVisible();

  await page.getByRole('button', { name: '首页看板' }).click();
  await page.getByLabel('快照日期').fill('2026-07-31');
  await expect(page.getByText('¥12,346').first()).toBeVisible();
  await expect(page.getByText('当前总资产')).toBeVisible();
  await expect(page.getByText('当前净资产')).toBeVisible();

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录 Flow Ledger' })).toBeVisible();
  await page.goto('/institutions');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
});
