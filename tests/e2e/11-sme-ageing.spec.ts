/** W3a-04: ageing tabs on the registers and the channel breakdown on transactions. */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('ageing and channels', async ({ page }) => {
  for (const path of ['/crm/money/receivables', '/crm/money/payables']) {
    await page.goto(path);
    await page.getByRole('tab', { name: 'Ageing' }).click();
    await expect(page.getByTestId('ageing').or(page.getByText('Nothing outstanding.'))).toBeVisible({ timeout: 15_000 });
  }
  await page.goto('/crm/money/transactions');
  await page.getByRole('button', { name: /By payment channel/ }).click();
  await expect(page.getByText('They do not connect to any bank, wallet or payment service.', { exact: false })).toBeVisible();
});
