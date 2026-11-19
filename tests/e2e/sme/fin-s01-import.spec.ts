/**
 * FIN-S01 (W2-06): import a Jordanian bank CSV, map date / description / amount, review, commit.
 * The same file is refused before parsing; an overlapping file posts only its new lines; each
 * commit emits one ImportCommitted event.
 */
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const FIXTURE_1 = path.join(__dirname, '../../fixtures/sme/bank_statement_jo_01.csv');
const FIXTURE_2 = path.join(__dirname, '../../fixtures/sme/bank_statement_jo_02.csv');

// Signing out elsewhere revokes shared sessions, and the API checks the session, so sign in here.
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

async function balance(accountId: string) {
  const res = await fetch(`${REST}/sme_account_balances?account_id=eq.${accountId}&select=balance_minor,transaction_count`, { headers: service });
  return (await res.json())[0] as { balance_minor: number; transaction_count: number };
}

async function chooseFile(page: Page, accountId: string, file: string) {
  await page.goto(`/crm/money/transactions/import?account=${accountId}`);
  await expect(page.getByRole('heading', { name: 'Import a bank statement' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Statement file (CSV or XLSX)').setInputFiles(file);
  await expect(page.getByLabel('Date column')).toHaveValue('0');
  await expect(page.getByLabel('Amount column')).toHaveValue('3');
  // Map date, description and amount only (FIN-S01); overlap is then caught by the fingerprint.
  await page.getByLabel('Bank reference column (optional)').selectOption('');
  await expect(page.getByText('Looks right').first()).toBeVisible();
}

async function uploadAndReview(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Upload and read the file' }).click();
  await page.waitForURL(/\/crm\/money\/transactions\/import\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  return page.url().split('/').pop()!;
}

test('FIN-S01: import, refuse the same file, and post only new lines from an overlapping one', async ({ page, request }) => {
  test.skip(!KEY || !process.env.CRON_SECRET, 'Needs the local seed, service key and cron secret');
  test.setTimeout(120_000);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const run = Date.now().toString(36);
  const created = await request.post('/api/sme/v1/accounts', {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `fin-s01-${run}` },
    data: { account: { kind: 'bank', name: `E2E statement ${run}`, currency: 'JOD' } },
  });
  expect(created.status()).toBe(201);
  const accountId = (await created.json()).account_id as string;

  // First statement: 30 lines.
  await chooseFile(page, accountId, FIXTURE_1);
  const batch1 = await uploadAndReview(page);
  const counts = page.getByTestId('import-counts');
  await expect(counts).toContainText('Valid: 30', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Include valid lines and leave out duplicates' }).click();
  await page.getByRole('button', { name: 'Post 30 lines' }).click();
  await expect(page.getByRole('heading', { name: 'Statement imported' })).toBeVisible();
  expect(await balance(accountId)).toEqual({ balance_minor: 10261700, transaction_count: 30 });

  // Posted lines show the file and line they came from.
  await page.getByRole('link', { name: 'View the account’s transactions' }).click();
  const first = page.getByTestId('transaction').filter({ hasText: 'Supplier payment - Al-Quds Packaging' }).first();
  await first.getByRole('button', { name: 'Details' }).click();
  await expect(first).toContainText('bank_statement_jo_01.csv, line 25');

  // The identical file is refused before parsing.
  await chooseFile(page, accountId, FIXTURE_1);
  await page.getByRole('button', { name: 'Upload and read the file' }).click();
  await expect(page.getByRole('region', { name: 'Tell us what each column means' }).getByRole('alert')).toContainText('This file was already imported on');
  const batches = await fetch(`${REST}/sme_import_batches?account_id=eq.${accountId}&select=id`, { headers: service });
  expect(await batches.json()).toHaveLength(1);

  // Overlapping statement: 10 lines already posted, 8 new.
  await chooseFile(page, accountId, FIXTURE_2);
  const batch2 = await uploadAndReview(page);
  await expect(counts).toContainText('Possible duplicate: 10', { timeout: 30_000 });
  await expect(counts).toContainText('Valid: 8');
  await expect(page.getByTestId('import-row')).toHaveCount(10);
  await page.getByRole('button', { name: 'Include valid lines and leave out duplicates' }).click();
  await page.getByRole('button', { name: 'Post 8 lines' }).click();
  await expect(page.getByTestId('committed-summary')).toContainText('8 lines were posted; 10 left out');
  expect(await balance(accountId)).toEqual({ balance_minor: 10261700 + 1370400, transaction_count: 38 });

  // One ImportCommitted event per batch, processed once by the worker.
  await request.get('/api/cron/sme-outbox', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  for (const id of [batch1, batch2]) {
    const events = await fetch(`${REST}/sme_outbox?event_type=eq.ImportCommitted&payload->>batchId=eq.${id}&select=processed_at`, { headers: service });
    const rows = (await events.json()) as Array<{ processed_at: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].processed_at).not.toBeNull();
  }
});
