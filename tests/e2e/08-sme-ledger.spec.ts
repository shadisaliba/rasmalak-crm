/**
 * W2-05: accounts, manual posting, reversal with a reason, idempotent API writes, no edits.
 * Ledger rows cannot be deleted (R6), so every run uses its own account name.
 */
import { test, expect, type Page } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const serviceHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('rasmalak-auth');
    return raw ? (JSON.parse(raw).access_token as string) : null;
  });
  if (!token) throw new Error('no session');
  return token;
}

// Signing out revokes every session of the user (Supabase's default global scope), and the
// API checks the session with the auth server, so these tests sign in with a session of their own.
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('post, reverse with a reason, and keep both rows', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const run = Date.now().toString(36);
  const accountName = `E2E bank ${run}`;
  const description = `Invoice paid ${run}`;

  await page.goto('/crm/money/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts and cash boxes' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const accountForm = page.locator('form[aria-labelledby="add-account-title"]');
  await accountForm.getByLabel('Name', { exact: true }).fill(accountName);
  await accountForm.getByLabel('Balance in JOD').fill('1,000.000');
  await accountForm.getByRole('button', { name: 'Save account' }).click();

  const accountCard = page.getByRole('listitem', { name: accountName });
  await expect(accountCard).toContainText('1,000.000');
  await expect(accountCard).toContainText('Opening balance is an estimate');
  const href = await accountCard.getByRole('link', { name: 'View transactions' }).getAttribute('href');
  const accountId = new URL(href!, 'http://x').searchParams.get('account')!;
  await accountCard.getByRole('link', { name: 'View transactions' }).click();
  await page.waitForURL(/\/crm\/money\/transactions\?account=/);

  await page.getByRole('button', { name: 'Add transaction' }).click();
  const txForm = page.locator('form[aria-labelledby="add-tx-title"]');
  await txForm.getByLabel('Direction').selectOption('in');
  await txForm.getByLabel('Amount in JOD').fill('250.500');
  await txForm.getByLabel('Description').fill(description);
  await txForm.getByLabel('Category').selectOption({ label: 'Sales' });
  await txForm.getByRole('button', { name: 'Post transaction' }).click();

  const original = page.getByTestId('transaction').filter({ hasText: description }).filter({ hasNotText: 'Reversal of an earlier entry' });
  await expect(original).toContainText('250.500');
  await expect(original).toContainText('Sales');

  await original.getByRole('button', { name: 'Reverse' }).click();
  await original.getByRole('button', { name: 'Reverse this entry' }).click();
  await expect(original.getByRole('alert')).toHaveText('Say why this entry is being reversed.');
  await original.getByLabel('Reason').fill('Entered on the wrong account');
  await original.getByRole('button', { name: 'Reverse this entry' }).click();

  await expect(original.getByRole('link', { name: 'Reversed: see the reversal' })).toBeVisible();
  await expect(original.getByTestId('amount')).toHaveCSS('text-decoration-line', 'line-through');
  const reversal = page.getByTestId('transaction').filter({ hasText: 'Reason: Entered on the wrong account' });
  await expect(reversal).toContainText('-JOD');
  await expect(reversal.getByRole('button', { name: 'Reverse' })).toHaveCount(0);

  const balance = await fetch(`${REST}/sme_account_balances?account_id=eq.${accountId}&select=balance_minor,transaction_count`, { headers: serviceHeaders });
  expect(await balance.json()).toEqual([{ balance_minor: 1000000, transaction_count: 3 }]);
});

test('API writes are idempotent and posted transactions cannot be edited', async ({ page, request }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  await page.goto('/crm/money/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts and cash boxes' })).toBeVisible({ timeout: 15_000 });
  const token = await accessToken(page);
  const headers = { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'content-type': 'application/json' };
  const run = Date.now().toString(36);

  const account = await request.post('/api/sme/v1/accounts', {
    headers: { ...headers, 'idempotency-key': `e2e-acc-${run}` },
    data: { account: { kind: 'cash', name: `E2E cash ${run}`, currency: 'JOD' } },
  });
  expect(account.status()).toBe(201);
  const accountId = (await account.json()).account_id as string;

  const body = { account_id: accountId, value_date: '2026-11-02', amount_minor: '-12500', description: 'Office supplies' };
  const first = await request.post('/api/sme/v1/transactions', { headers: { ...headers, 'idempotency-key': `e2e-tx-${run}` }, data: body });
  const second = await request.post('/api/sme/v1/transactions', { headers: { ...headers, 'idempotency-key': `e2e-tx-${run}` }, data: body });
  expect(first.status()).toBe(201);
  expect((await second.json()).transaction_id).toBe((await first.json()).transaction_id);

  const missingKey = await request.post('/api/sme/v1/transactions', { headers, data: body });
  expect(missingKey.status()).toBe(400);
  expect((await missingKey.json()).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

  const count = await fetch(`${REST}/sme_transactions?account_id=eq.${accountId}&select=id`, { headers: serviceHeaders });
  expect(await count.json()).toHaveLength(1);

  for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
    const res = await request.fetch('/api/sme/v1/transactions', { method, headers: { ...headers, 'idempotency-key': `e2e-${method}-${run}` }, data: body });
    expect(res.status(), method).toBe(405);
  }

  const noRate = await request.post('/api/sme/v1/accounts', {
    headers: { ...headers, 'idempotency-key': `e2e-usd-${run}` },
    data: { account: { kind: 'bank', name: `E2E USD ${run}`, currency: 'USD' }, opening: { amount_minor: '10000', value_date: '2026-11-02', is_estimate: true } },
  });
  expect(noRate.status()).toBe(422);
  const error = (await noRate.json()).error;
  expect(error.code).toBe('FX_RATE_REQUIRED');
  expect(error.message_ar).toBeTruthy();
});
