/**
 * W2-07: "Explore with sample data" opens a separate demo organization; the live one is untouched
 * and is where the user returns to.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}` };

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('sample data lives in its own organization', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  await page.goto('/crm/money/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts and cash boxes' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore with sample data' }).first().click();

  await expect(page.getByTestId('demo-banner')).toContainText('You are exploring sample data', { timeout: 20_000 });
  await expect(page.getByLabel('Organization')).toContainText('(sample data)');
  await expect(page.getByRole('listitem', { name: 'Main bank account (sample)' })).toBeVisible();
  await expect(page.getByTestId('data-quality')).toContainText('Data quality:');

  await page.getByRole('button', { name: /^Back to / }).click();
  await expect(page.getByTestId('demo-banner')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole('listitem', { name: 'Main bank account (sample)' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Accounts and cash boxes' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);

  const live = await fetch(`${REST}/sme_accounts?org_id=eq.${ORG_A}&name=like.*(sample)*&select=id`, { headers: service });
  expect(await live.json()).toEqual([]);
  const demos = await fetch(`${REST}/organizations?is_demo=eq.true&select=id,country`, { headers: service });
  expect((await demos.json()).length).toBeGreaterThan(0);
});
