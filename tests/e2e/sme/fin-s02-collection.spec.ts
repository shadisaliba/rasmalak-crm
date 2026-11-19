/**
 * FIN-S02 (W3a-02): an invoice record never moves cash; a receipt is matched partially; over-
 * allocation and reversing a matched receipt are refused.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('FIN-S02: record, collect partially, and refuse over-allocation', async ({ page, request }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const run = Date.now().toString(36);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const api = (path: string, data: unknown, key: string) => request.post(`/api/sme/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `${key}-${run}` }, data,
  });
  const balance = async (id: string) => (await (await fetch(`${REST}/sme_account_balances?account_id=eq.${id}&select=balance_minor`, { headers: service })).json())[0].balance_minor;

  const accountId = (await (await api('accounts', { account: { kind: 'bank', name: `FIN-S02 bank ${run}`, currency: 'JOD' }, opening: { amount_minor: '1000000', value_date: '2026-10-01', is_estimate: false } }, 'acc')).json()).account_id;
  const customer = `Al-Noor Trading ${run}`;
  await fetch(`${REST}/crm_companies`, { method: 'POST', headers: service, body: JSON.stringify({ org_id: ORG_A, name: customer, created_by: OWNER_A }) });

  await page.goto('/crm/money/receivables');
  await expect(page.getByTestId('register-note')).toContainText('This is not a tax invoice and is not submitted to JoFotara.', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Record an invoice' }).click();
  await page.getByLabel('Customer', { exact: true }).selectOption({ label: customer });
  const line = page.getByTestId('invoice-line').first();
  await line.getByLabel('Description').fill('Design work');
  await line.getByLabel('Unit price (JOD)').fill('800');
  await expect(page.getByTestId('invoice-totals')).toContainText('800.000');
  await page.getByRole('button', { name: 'Save as issued' }).click();
  await page.waitForURL(/\/crm\/money\/receivables\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const invoiceId = page.url().split('/').pop()!;
  await expect(page.getByTestId('register-outstanding-amount')).toHaveText('JOD 800.000');
  expect(await balance(accountId)).toBe(1000000);

  const receipt = await (await api('transactions', { account_id: accountId, value_date: '2026-11-10', amount_minor: '300000', description: `Payment ${run}` }, 'r1')).json();
  await page.getByRole('button', { name: 'Match a receipt' }).click();
  await page.getByRole('radio', { name: new RegExp(`Payment ${run}`) }).check();
  await expect(page.getByLabel('Amount in JOD')).toHaveValue('300.000');
  await page.getByRole('button', { name: 'Match', exact: true }).click();
  await expect(page.getByTestId('register-outstanding-amount')).toHaveText('JOD 500.000');
  await expect(page.getByText('Partly paid')).toBeVisible();
  expect(await balance(accountId)).toBe(1300000);

  const big = await (await api('transactions', { account_id: accountId, value_date: '2026-11-11', amount_minor: '600000' }, 'r2')).json();
  const over = await api(`invoices/${invoiceId}/allocations`, { transaction_id: big.transaction_id, amount_minor: '600000' }, 'a2');
  expect(over.status()).toBe(409);
  expect((await over.json()).error.code).toBe('OVER_ALLOCATION');

  const reverse = await api(`transactions/${receipt.transaction_id}/reverse`, { reason: 'wrong customer' }, 'rev');
  expect(reverse.status()).toBe(409);
  expect((await reverse.json()).error.code).toBe('ALLOCATED_REVERSE_FIRST');
});
