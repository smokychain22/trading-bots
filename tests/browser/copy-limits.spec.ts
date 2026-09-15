import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]] as const) {
  test(`optional copy limits preserve recommended, zero and custom values on ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    let saved: Record<string, unknown> | null = null;
    await page.route('**/api/v1/copy/readiness', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.follower_account = { ...body.data.follower_account, connected: true, ready_for_theta: true };
      body.data.saved_policy = saved;
      await route.fulfill({ json: body });
    });
    await page.route('**/api/v1/copy/participation', async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { data: { policy: saved, order_submission: 'LOCKED' } } });
    });
    await page.goto('/bots/theta/copy');
    await expect(page.getByLabel('Use THETA recommended account limits')).toBeChecked();
    await expect(page.locator('[name=max_open_positions]')).toBeDisabled();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Save setup', exact: true }).click();
    await expect.poll(() => saved?.limit_mode).toBe('RECOMMENDED');
    expect(saved?.max_open_positions).toBeNull();
    await page.waitForURL('**/my-bots');
    await page.goto('/bots/theta/copy');
    await page.getByLabel('Use THETA recommended account limits').uncheck();
    await page.getByText('Advanced account limits', { exact: true }).click();
    await page.locator('[data-limit=max_open_positions]').selectOption('custom');
    await page.locator('[name=max_open_positions]').fill('0');
    await page.locator('[data-limit=max_slippage_per_contract_usd]').selectOption('custom');
    await page.locator('[name=max_slippage_per_contract_usd]').fill('2.75');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`copy-limits-${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Save setup', exact: true }).click();
    await expect.poll(() => saved?.limit_mode).toBe('CUSTOM');
    expect(saved?.max_open_positions).toBe(0);
    expect(saved?.max_daily_loss_usd).toBeNull();
    expect(saved?.max_slippage_per_contract_usd).toBe(2.75);
    await page.waitForURL('**/my-bots');
    await page.goto('/bots/theta/copy');
    await page.getByText('Advanced account limits', { exact: true }).click();
    await expect(page.getByLabel('Use THETA recommended account limits')).not.toBeChecked();
    await expect(page.locator('[name=max_open_positions]')).toHaveValue('0');
    await expect(page.locator('[name=max_slippage_per_contract_usd]')).toHaveValue('2.75');
  });
}

test('master account cannot enter copy setup', async ({ page }) => {
  await page.route('**/api/v1/copy/readiness', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data.follower_account.account_role = 'MASTER_THETA_PAPER';
    await route.fulfill({ json: body });
  });
  await page.goto('/bots/theta/copy');
  await expect(page.getByRole('heading', { name: 'THETA Paper master account' })).toBeVisible();
  await expect(page.locator('#copy-policy')).toHaveCount(0);
});

test('My Bots uses persisted follower facts and pause keeps management active',async({page})=>{
  let command:string|null=null;
  await page.route('**/api/v1/copy/readiness',async(route)=>{
    const response=await route.fetch();
    const body=await response.json();
    body.data.participation='COPY_NEW_AND_MANAGE';
    body.data.saved_policy={allocation_usd:12500,limit_mode:'RECOMMENDED'};
    body.data.follower_account={...body.data.follower_account,connected:true,ready_for_theta:true,
      masked_account:'••••1234',open_positions:2,last_sync_at:'2026-09-15T14:30:00Z'};
    await route.fulfill({json:body});
  });
  await page.route('**/api/v1/copy/participation/state',async(route)=>{
    command=route.request().postDataJSON().command;
    await route.fulfill({json:{data:{participation:'STOP_NEW_ENTRIES',existing_positions_remain_managed:true,
      order_submission:'LOCKED'}}});
  });
  await page.goto('/my-bots');
  await expect(page.getByText('$12,500')).toBeVisible();
  await expect(page.getByText('••••1234')).toBeVisible();
  await expect(page.getByText('2',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Stop new trades'}).click();
  await expect.poll(()=>command).toBe('PAUSE_NEW_TRADES');
  await expect(page.getByText('New entries stopped. Existing copied positions remain managed.')).toBeVisible();
});
