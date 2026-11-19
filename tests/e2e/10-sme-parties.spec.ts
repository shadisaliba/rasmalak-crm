/**
 * W3a-01: companies serve as customers and suppliers; identifiers are masked and every reveal is
 * audited.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}` };

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('a supplier with a masked tax number', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const name = `E2E Supplier ${Date.now().toString(36)}`;
  await page.goto('/crm/companies');
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Add company' }).click();
  const form = page.locator('form[aria-labelledby="add-company-title"]');
  await form.getByLabel('Company Name', { exact: true }).fill(name);
  await form.getByLabel('Supplier').check();
  await form.getByRole('button', { name: 'Save' }).click();

  await page.getByLabel('Show').selectOption('supplier');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await page.getByLabel('Show').selectOption('customer');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
  await page.getByLabel('Show').selectOption('supplier');
  await page.getByRole('link', { name: new RegExp(name) }).click();

  await page.getByRole('tab', { name: 'Finance' }).click();
  const panel = page.getByTestId('party-finance');
  await expect(panel.getByLabel('Supplier')).toBeChecked();
  await panel.getByRole('textbox', { name: 'Number' }).fill('١٢٣ ٤٥٦ ٧٨٩');
  await panel.getByRole('button', { name: 'Save identifier' }).click();
  await expect(panel.getByTestId('identifier-value')).toHaveText('•••• 6789');
  await panel.getByRole('button', { name: 'Show full number' }).click();
  await expect(panel.getByTestId('identifier-value')).toHaveText('123456789');

  const company = await (await fetch(`${REST}/crm_companies?name=eq.${encodeURIComponent(name)}&select=id,party_roles`, { headers: service })).json();
  expect(company[0].party_roles).toEqual(['supplier']);
  const audits = await fetch(`${REST}/sme_audit_events?action=eq.party.identifier.revealed&payload->>last4=eq.6789&select=id`, { headers: service });
  expect((await audits.json()).length).toBeGreaterThan(0);
});
