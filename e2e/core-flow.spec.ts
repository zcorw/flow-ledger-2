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
  test.setTimeout(120_000);
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
    page.getByRole('heading', { level: 1, name: '首页看板', exact: true }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page, 'dashboard-empty');

  await page.getByRole('button', { name: '机构与账户' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '机构与账户', exact: true }),
  ).toBeVisible();
  const addButtons = page.getByRole('button', { name: '新增' });

  await addButtons.nth(1).click();
  const unassignedAccountDialog = page.getByRole('dialog');
  await unassignedAccountDialog.getByLabel('名称').fill('E2E Account');
  await unassignedAccountDialog.getByLabel('所属机构').click();
  await page.getByRole('option', { name: '暂不关联（稍后设置）' }).click();
  await unassignedAccountDialog.getByLabel('脱敏标识').fill('尾号 2468');
  await unassignedAccountDialog.getByLabel('选择自定义显示颜色').fill('#66558c');
  await expect(unassignedAccountDialog.getByLabel('选择自定义显示颜色')).toHaveValue('#66558c');
  const unassignedAccountRequestPromise = page.waitForRequest(
    (request) => request.url().endsWith('/api/v1/accounts') && request.method() === 'POST',
  );
  await unassignedAccountDialog.getByRole('button', { name: '保存' }).click();
  expect((await unassignedAccountRequestPromise).postDataJSON().institutionId).toBeNull();
  await page.getByText('待关联账户', { exact: true }).click();
  await expect(page.getByText('E2E Account', { exact: true })).toBeVisible();

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

  await addButtons.nth(0).click();
  const emptyInstitutionDialog = page.getByRole('dialog');
  await emptyInstitutionDialog.getByLabel('名称').fill('E2E Empty Institution');
  await emptyInstitutionDialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('E2E Empty Institution', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除机构 E2E Empty Institution' }).click();
  const deleteEmptyInstitutionDialog = page.getByRole('dialog');
  await expect(deleteEmptyInstitutionDialog.getByText('删除成功后无法恢复。', { exact: false })).toBeVisible();
  const deleteEmptyInstitutionResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/institutions/') &&
      response.request().method() === 'DELETE',
  );
  await deleteEmptyInstitutionDialog.getByRole('button', { name: '确认删除' }).click();
  expect((await deleteEmptyInstitutionResponse).status()).toBe(204);
  await expect(deleteEmptyInstitutionDialog).not.toBeVisible();
  await expect(page.getByText('E2E Empty Institution', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '编辑账户 E2E Account' }).click();
  const associateAccountDialog = page.getByRole('dialog');
  await associateAccountDialog.getByLabel('所属机构').click();
  await page.getByRole('option', { name: 'E2E Bank' }).click();
  const associateAccountRequestPromise = page.waitForRequest(
    (request) => request.url().includes('/api/v1/accounts/') && request.method() === 'PUT',
  );
  await associateAccountDialog.getByRole('button', { name: '保存' }).click();
  expect((await associateAccountRequestPromise).postDataJSON().institutionId).toBeTruthy();
  await expect(associateAccountDialog).not.toBeVisible();
  await page.getByText('E2E Bank', { exact: true }).click();
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
  await expect(page.getByRole('columnheader', { name: 'CNY 折算', exact: true })).toHaveAttribute('aria-colindex', '7');
  await expect(page.getByRole('columnheader', { name: '上月原币金额', exact: true })).toHaveAttribute('aria-colindex', '8');
  await expect(page.getByRole('columnheader', { name: '较上月变化', exact: true })).toHaveAttribute('aria-colindex', '9');
  const assetRow = page.getByRole('row').filter({ hasText: 'E2E Balance' });
  await expect(assetRow).toBeVisible();
  const amountCell = assetRow.getByRole('gridcell').nth(5);
  await amountCell.click();
  const amountInput = amountCell.getByRole('textbox');
  await amountInput.fill('123.45.6');
  await page.getByLabel('快照日期').click();
  await expect(amountInput).toHaveValue('123.45.6');
  await expect(amountInput).toHaveAttribute('aria-invalid', 'true');
  await expect(amountInput).toBeFocused();
  await expect(page.getByText('E2E Balance的原币金额不合法')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await amountInput.fill('12345.67');
  await amountInput.press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('月度快照已保存')).toBeVisible();
  await expectNoSeriousAccessibilityIssues(page, 'snapshot-grid');

  await page.getByLabel('快照日期').fill('2026-08-31');
  await expect(assetRow).toBeVisible();
  await amountCell.click();
  await amountCell.getByRole('textbox').fill('40000');
  await amountCell.getByRole('textbox').press('Tab');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('异常变化项目：E2E Bank / E2E Account / E2E Balance')).toBeVisible();
  await expect(assetRow).toHaveClass(/snapshot-row--unusual/);

  await page.getByRole('button', { name: '机构与账户' }).click();
  await page.getByRole('button', { name: '查看机构历史 E2E Bank' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Bank' })).toBeVisible();
  await expect(page.getByText('机构历史', { exact: true })).toBeVisible();
  await expect(page.getByText('按当前关联关系实时汇总；调整账户关联后，全部历史会同步转移。')).toBeVisible();
  const institutionHistoryRows = page
    .getByRole('grid', { name: 'E2E Bank历史快照明细' })
    .getByRole('row')
    .filter({ hasText: 'E2E Balance' });
  await expect(institutionHistoryRows).toHaveCount(2);
  await expect(institutionHistoryRows.filter({ hasText: '2026-07-31' })).toHaveCount(1);
  await expect(institutionHistoryRows.filter({ hasText: '2026-08-31' })).toHaveCount(1);
  await page.getByRole('button', { name: '返回机构与账户' }).click();

  await page.getByRole('button', { name: '查看账户历史 E2E Account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Account' })).toBeVisible();
  await expect(page.getByText('账户历史', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回机构与账户' }).click();

  await page.getByRole('button', { name: '查看项目历史 E2E Balance' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Balance' })).toBeVisible();
  await expect(page.getByText('项目历史', { exact: true })).toBeVisible();
  const historyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  expect((await historyDownload).suggestedFilename()).toBe('E2E Balance-历史快照.csv');
  await page.getByRole('button', { name: '返回机构与账户' }).click();

  await page.getByRole('button', { name: '删除项目 E2E Balance' }).click();
  const blockedDeleteDialog = page.getByRole('dialog');
  const blockedDeleteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/projects/') &&
      response.request().method() === 'DELETE',
  );
  await blockedDeleteDialog.getByRole('button', { name: '确认删除' }).click();
  expect((await blockedDeleteResponse).status()).toBe(409);
  await expect(blockedDeleteDialog.getByText('项目已有快照记录，不能删除；如不再使用，请将项目停用')).toBeVisible();
  await blockedDeleteDialog.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '首页看板' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '首页看板', exact: true }),
  ).toBeVisible();
  const dashboardMonth = page.getByLabel('统计月份');
  await expect(dashboardMonth).toHaveText('2026年08月');
  await dashboardMonth.click();
  await expect(page.getByRole('option', { name: '2026年10月（无数据）' })).toBeDisabled();
  await page.getByRole('option', { name: '2026年07月' }).click();
  await expect(page.getByText('¥12,346').first()).toBeVisible();
  await expect(page.getByText('当月总资产')).toBeVisible();
  await expect(page.getByText('当月净资产')).toBeVisible();
  await expect(page.getByText('E2E Bank-E2E Balance', { exact: true })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: '首页看板', exact: true }),
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
  await page.getByRole('button', { name: '债权债务' }).click();
  await page.getByRole('button', { name: '新增债权' }).click();
  const createDebtDialog = page.getByRole('dialog', { name: '新增债权' });
  await createDebtDialog.getByLabel('交易对手').fill('E2E Future Friend');
  await createDebtDialog.getByRole('button', { name: '创建' }).click();
  await expect(createDebtDialog).not.toBeVisible();

  await page.getByRole('button', { name: '添加事件' }).click();
  let eventDialog = page.getByRole('dialog', { name: '添加事件' });
  await eventDialog.getByLabel('发生日期').fill('2099-01-01');
  await eventDialog.getByLabel('金额').fill('10000');
  await eventDialog.getByRole('button', { name: '保存事件' }).click();
  await expect(eventDialog).not.toBeVisible();

  await page.getByRole('button', { name: '添加事件' }).click();
  eventDialog = page.getByRole('dialog', { name: '添加事件' });
  await eventDialog.getByLabel('事件类型').click();
  await page.getByRole('option', { name: '还款' }).click();
  await eventDialog.getByLabel('发生日期').fill('2099-01-02');
  await eventDialog.getByLabel('金额').fill('3000');
  await eventDialog.getByRole('button', { name: '保存事件' }).click();
  await expect(eventDialog).not.toBeVisible();
  await expect(page.getByText('CNY 7,000.00', { exact: true })).toHaveCount(2);
  await expect(page.getByText('当前未偿本金 CNY 7,000.00', { exact: true })).toBeVisible();
  await expect(page.getByText('部分偿还', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除事件 还款 2099-01-02' }).click();
  const deleteEventDialog = page.getByRole('dialog', { name: '删除单个事件？' });
  await expect(deleteEventDialog.getByText('此操作不可撤销')).toBeVisible();
  await deleteEventDialog.getByRole('button', { name: '确认删除事件' }).click();
  await expect(deleteEventDialog).not.toBeVisible();
  await expect(page.getByText('CNY 10,000.00', { exact: true })).toHaveCount(2);
  await expect(page.getByText('进行中', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除对象' }).click();
  const deleteDebtDialog = page.getByRole('dialog', { name: '删除债权对象？' });
  await expect(deleteDebtDialog.getByText('高风险操作，不可撤销')).toBeVisible();
  await expect(deleteDebtDialog.getByText(/全部 1 条事件/)).toBeVisible();
  await deleteDebtDialog.getByRole('button', { name: '删除对象及全部事件' }).click();
  await expect(deleteDebtDialog).not.toBeVisible();
  await expect(page.getByText('E2E Future Friend', { exact: true })).not.toBeVisible();

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
  const masterDataOperations = page.getByRole('region', { name: '机构、账户与项目导入导出' });
  const snapshotOperations = page.getByRole('region', { name: '月度快照导入导出' });
  const debtOperations = page.getByRole('region', { name: '债权债务事件导入导出' });
  await expect(masterDataOperations.getByText('未选择文件')).toBeVisible();
  await expect(masterDataOperations.getByRole('button', { name: '下载模板' })).toBeVisible();
  await expect(masterDataOperations.getByRole('button', { name: '选择文件' })).toBeVisible();
  const [masterDataBox, snapshotBox, debtBox] = await Promise.all([
    masterDataOperations.boundingBox(),
    snapshotOperations.boundingBox(),
    debtOperations.boundingBox(),
  ]);
  expect(masterDataBox).not.toBeNull();
  expect(snapshotBox).not.toBeNull();
  expect(debtBox).not.toBeNull();
  expect(snapshotBox!.y).toBeGreaterThan(masterDataBox!.y + masterDataBox!.height);
  expect(debtBox!.y).toBeGreaterThan(snapshotBox!.y + snapshotBox!.height);

  const masterDataDownload = page.waitForEvent('download');
  await masterDataOperations.getByRole('button', { name: '导出数据' }).click();
  expect((await masterDataDownload).suggestedFilename()).toMatch(
    /^flow-ledger-master-data-\d{4}-\d{2}-\d{2}\.zip$/,
  );
  await expect(page.getByText('主数据已导出')).toBeVisible();

  await snapshotOperations.getByRole('button', { name: '导出数据' }).click();
  const snapshotExportDialog = page.getByRole('dialog', { name: '导出月度快照' });
  await snapshotExportDialog.getByLabel('开始日期').fill('2026-07-01');
  await snapshotExportDialog.getByLabel('结束日期').fill('2026-07-31');
  const snapshotDataDownload = page.waitForEvent('download');
  await snapshotExportDialog.getByRole('button', { name: '导出 CSV' }).click();
  expect((await snapshotDataDownload).suggestedFilename()).toBe(
    'flow-ledger-monthly-snapshots-2026-07-01-2026-07-31.csv',
  );

  await debtOperations.getByRole('button', { name: '导出数据' }).click();
  const debtExportDialog = page.getByRole('dialog', { name: '导出债权债务事件' });
  await debtExportDialog.getByLabel('债权债务类型').click();
  await page.getByRole('option', { name: '债权', exact: true }).click();
  await debtExportDialog.getByLabel('开始日期').fill('2026-07-01');
  await debtExportDialog.getByLabel('结束日期').fill('2026-07-31');
  const debtDataDownload = page.waitForEvent('download');
  await debtExportDialog.getByRole('button', { name: '导出 CSV' }).click();
  expect((await debtDataDownload).suggestedFilename()).toBe(
    'flow-ledger-debt-events-receivable-2026-07-01-2026-07-31.csv',
  );

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
  await expect(page.getByRole('heading', { level: 1, name: '首页看板' })).toBeVisible();
  await expect(page.getByText('E2E 管理员', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '登录 Flow Ledger' })).toBeVisible();
  await page.goto('/institutions');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/login$/);
});
