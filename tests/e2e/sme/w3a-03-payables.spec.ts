/**
 * W3a-03: a supplier bill paid in two parts shows the right amount owed after each part; the due
 * list and supplier concentration reflect it; nothing initiates a payment.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('a bill paid in two parts', async ({ page, request }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const run = Date.now().toString(36);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const api = (path: string, data: unknown, key: string) => request.post(`/api/sme/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `${key}-${run}` }, data,
  });
  const balance = async (id: string) => (await (await fetch(`${REST}/sme_account_balances?account_id=eq.${id}&select=balance_minor`, { headers: service })).json())[0].balance_minor;

  const accountId = (await (await api('accounts', { account: { kind: 'bank', name: `Payables bank ${run}`, currency: 'JOD' }, opening: { amount_minor: '2000000', value_date: '2026-10-01', is_estimate: false } }, 'acc')).json()).account_id;
  const supplier = `Al-Quds Packaging ${run}`;
  await fetch(`${REST}/crm_companies`, { method: 'POST', headers: service, body: JSON.stringify({ org_id: ORG_A, name: supplier, created_by: OWNER_A }) });

  await page.goto('/crm/money/payables');
  await expect(page.getByTestId('payables-due')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Record a bill' }).click();
  await page.getByLabel('Supplier', { exact: true }).selectOption({ label: supplier });
  await page.getByLabel('Supplier’s bill number').fill(`AQ-${run}`);
  const line = page.getByTestId('invoice-line').first();
  await line.getByLabel('Description').fill('Boxes');
  await line.getByLabel('Unit price (JOD)').fill('800');
  await page.getByRole('button', { name: 'Save as approved' }).click();
  await page.waitForURL(/\/crm\/money\/payables\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByTestId('register-outstanding-amount')).toHaveText('JOD 800.000');
  expect(await balance(accountId)).toBe(2000000);

  // First part: record the payment and mark it paid in one step.
  await page.getByRole('button', { name: 'Record payment and mark paid' }).click();
  await page.getByLabel('Account', { exact: true }).selectOption({ label: `Payables bank ${run}` });
  await page.getByLabel('Amount in JOD').fill('300');
  await page.getByRole('button', { name: 'Record and match' }).click();
  await expect(page.getByTestId('register-outstanding-amount')).toHaveText('JOD 500.000');
  await expect(page.getByText('Partly paid')).toBeVisible();
  expect(await balance(accountId)).toBe(1700000);

  // Second part: match an outflow already in the account.
  await api('transactions', { account_id: accountId, value_date: '2026-11-12', amount_minor: '-500000', description: `Transfer to supplier ${run}` }, 'out2');
  await page.getByRole('button', { name: 'Match a payment' }).click();
  await page.getByRole('radio', { name: new RegExp(`Transfer to supplier ${run}`) }).check();
  await page.getByRole('button', { name: 'Match', exact: true }).click();
  await expect(page.getByTestId('register-outstanding-amount')).toHaveText('JOD 0.000');
  await expect(page.locator('h1 + span')).toHaveText('Paid');
  expect(await balance(accountId)).toBe(1200000);

  await page.goto('/crm/money/payables');
  await expect(page.getByText(supplier).first()).toBeVisible({ timeout: 15_000 });
});
