import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoSeriousAccessibilityIssues(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  await test.info().attach(`axe-${name}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test('initializes, records an asset snapshot, verifies the dashboard, and logs out', async ({
  context,
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: '初始化管理员' })).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page, 'setup');
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
  await expectNoSeriousAccessibilityIssues(page, 'dashboard-empty');

  await page.getByRole('button', { name: '机构与账户' }).click();
  await expect(
    page.getByRole('heading', { level: 4, name: '机构与账户', exact: true }),
  ).toBeVisible();
  const addButtons = page.getByRole('button', { name: '新增' });
  await addButtons.nth(0).click();
  const institutionDialog = page.getByRole('dialog');
  await institutionDialog.getByLabel('名称').fill('E2E Bank');
  await expect(institutionDialog.getByLabel('选择自定义显示颜色')).toHaveAttribute('type', 'color');
  await institutionDialog.getByRole('button', { name: '选择颜色 #397C93' }).click();
  await expect(institutionDialog.getByRole('button', { name: '选择颜色 #397C93' })).toHaveAttribute('aria-pressed', 'true');
  const institutionRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/v1/institutions') && request.method() === 'POST',
  );
  await institutionDialog.getByRole('button', { name: '保存' }).click();
  const institutionRequest = await institutionRequestPromise;
  expect(institutionRequest.postDataJSON().displayColor).toBe('#397c93');
  await expect(page.getByText('E2E Bank', { exact: true })).toBeVisible();
  await page.getByText('E2E Bank', { exact: true }).click();

  await addButtons.nth(1).click();
  await page.getByRole('dialog').getByLabel('名称').fill('E2E Account');
  await page.getByRole('dialog').getByLabel('脱敏标识').fill('尾号 2468');
  await page.getByRole('dialog').getByLabel('选择自定义显示颜色').fill('#66558c');
  await expect(page.getByRole('dialog').getByLabel('选择自定义显示颜色')).toHaveValue('#66558c');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Account', { exact: true })).toBeVisible();
  await page.getByText('E2E Account', { exact: true }).click();

  await addButtons.nth(2).click();
  await page.getByRole('dialog').getByLabel('名称').fill('E2E Balance');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Balance', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expectNoSeriousAccessibilityIssues(page, 'master-data');

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
  await expectNoSeriousAccessibilityIssues(page, 'snapshot-grid');

  await page.getByRole('button', { name: '首页看板' }).click();
  await expect(
    page.getByRole('heading', { level: 4, name: '首页看板', exact: true }),
  ).toBeVisible();
  await page.getByLabel('快照日期').fill('2026-07-31');
  await expect(page.getByText('¥12,346').first()).toBeVisible();
  await expect(page.getByText('当前总资产')).toBeVisible();
  await expect(page.getByText('当前净资产')).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 4, name: '首页看板', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transitionDuration = await page.getByRole('button', { name: '退出登录' }).evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(transitionDuration).toBeLessThanOrEqual(0.1);

  await page.setViewportSize({ width: 390, height: 844 });
  const menuButton = page.getByRole('button', { name: '打开导航菜单' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(page.getByRole('navigation', { name: '主要导航' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: '主要导航' })).not.toBeVisible();
  await menuButton.click();
  await page.getByRole('button', { name: '首页看板' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectNoSeriousAccessibilityIssues(page, 'mobile-dashboard');

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '机构与账户' }).click();
  await page.getByRole('button', { name: '编辑机构 E2E Bank' }).click();
  const editInstitutionDialog = page.getByRole('dialog');
  await editInstitutionDialog.getByRole('switch', { name: '启用' }).uncheck();
  const deactivateInstitutionResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/institutions/') && response.request().method() === 'PUT',
  );
  await editInstitutionDialog.getByRole('button', { name: '保存' }).click();
  expect((await deactivateInstitutionResponse).status()).toBe(200);
  await expect(page.getByText('停用', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '月度快照' }).click();
  const filteredSnapshotResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/snapshots?date=2026-07-31') &&
      response.request().method() === 'GET',
  );
  await page.getByLabel('快照日期').fill('2026-07-31');
  expect((await filteredSnapshotResponse).status()).toBe(200);
  await expect(page.getByRole('row').filter({ hasText: 'E2E Balance' })).toHaveCount(0);

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();

  const profileForm = page.getByRole('form', { name: '修改账户资料' });
  await profileForm.getByLabel('显示名称').fill('E2E 管理员');
  const profileResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/profile') && response.request().method() === 'PATCH',
  );
  await profileForm.getByRole('button', { name: '保存显示名称' }).click();
  expect((await profileResponsePromise).status()).toBe(200);
  await expect(page.getByText('显示名称已更新')).toBeVisible();
  await expect(page.getByText('E2E 管理员', { exact: true }).first()).toBeVisible();

  const passwordForm = page.getByRole('form', { name: '修改密码' });
  await passwordForm.getByLabel('当前密码').fill('e2e-password-123');
  await passwordForm.getByLabel('新密码', { exact: true }).fill('e2e-password-456');
  await passwordForm.getByLabel('确认新密码').fill('e2e-password-456');
  const passwordResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/change-password') &&
      response.request().method() === 'POST',
  );
  await passwordForm.getByRole('button', { name: '更新密码' }).click();
  expect((await passwordResponsePromise).status()).toBe(200);
  await expect(page.getByText('密码已更新，其他登录会话已退出')).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page, 'account-settings');

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录 Flow Ledger' })).toBeVisible();
  await page.getByLabel('邮箱地址').fill('e2e@example.com');
  await page.getByLabel('密码').fill('e2e-password-456');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { level: 4, name: '首页看板' })).toBeVisible();
  await expect(page.getByText('E2E 管理员', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录 Flow Ledger' })).toBeVisible();
  await page.goto('/institutions');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
});
