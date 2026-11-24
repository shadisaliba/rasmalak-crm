/**
 * W3a-11 (FIN-01): the financial home shows cash, money coming in and going out in 14 days, the
 * lowest forecast point and the top actions, each linking to its figures; viewing it is counted
 * as a product event without amounts or names.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

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

test('FIN-01: every card has its figure and a way to the figures behind it', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const since = new Date().toISOString();
  await page.goto('/crm/dashboard');

  await expect(page.getByTestId('home-cash')).toContainText('JOD', { timeout: 30_000 });
  await expect(page.getByTestId('home-cash').getByRole('link', { name: 'View accounts' })).toHaveAttribute('href', '/crm/money/accounts');
  await expect(page.getByTestId('home-collect')).toContainText('Coming in, next 14 days');
  await expect(page.getByTestId('home-collect').getByRole('link')).toHaveAttribute('href', '/crm/money/receivables');
  await expect(page.getByTestId('home-pay')).toContainText('Going out, next 14 days');
  const lowest = page.getByTestId('home-lowest');
  await expect(lowest).toContainText('Lowest cash in the next 13 weeks', { timeout: 30_000 });
  await expect(lowest.getByRole('link', { name: 'View the forecast' })).toHaveAttribute('href', '/crm/money/forecast');
  await expect(page.getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/crm/money/actions');

  // DashboardViewed is recorded once, with flags only.
  await expect.poll(async () => {
    const rows = await (await fetch(`${REST}/sme_product_events?org_id=eq.${ORG_A}&event_name=eq.DashboardViewed&created_at=gt.${encodeURIComponent(since)}&select=props`, { headers: service })).json() as Array<{ props: Record<string, unknown> }>;
    return rows.map(r => Object.values(r.props).every(v => typeof v === 'boolean'));
  }, { timeout: 15_000 }).toEqual([true]);
});
