/**
 * W2-03 (blueprint §4): a JOD business can be set up with partial information; unknown tax
 * status produces a reminder, not a conclusion.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function resetProfile() {
  if (!KEY) return;
  for (const table of ['sme_actions', 'sme_profile_facts', 'sme_business_profiles']) {
    await fetch(`${REST}/${table}?org_id=eq.${ORG_A}`, { method: 'DELETE', headers });
  }
}

test.beforeEach(forceEnglish);
test.beforeAll(resetProfile);
test.afterAll(resetProfile);

test('partial onboarding reaches the end with neutral reminders', async ({ page }) => {
  test.skip(!KEY, 'Needs the local service key');
  await page.goto('/crm/dashboard');
  await page.getByRole('link', { name: 'Continue setup' }).click();
  await page.waitForURL(/\/crm\/onboarding/);

  await page.getByLabel('Business name (Arabic)').fill('استوديو لينا');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page.getByText('Jordanian dinar (JOD), with three decimal places.')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByText('Step 3 of 5')).toBeVisible();
  const tax = page.getByRole('group', { name: 'Is the business registered for income tax?' });
  await tax.getByLabel('Not sure').check();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page.getByText('Step 4 of 5')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Your business profile is set up' })).toBeVisible();
  await expect(page.getByText(/items still need an answer/)).toBeVisible();

  const res = await fetch(`${REST}/sme_actions?org_id=eq.${ORG_A}&dedupe_key=eq.profile.missing_fact:fact.income_tax.registered&select=status`, { headers });
  expect(await res.json()).toEqual([{ status: 'open' }]);
  await expect(page.getByText(/you (are|must|need to) (register|comply)/i)).toHaveCount(0);
});
