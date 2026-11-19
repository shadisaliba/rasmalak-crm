/**
 * W2-02: an owner invites an adviser limited to chosen modules, sees the scope, and revokes it.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const INVITEE_ID = 'e0000000-0000-4000-e000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function removeInvitee() {
  if (!KEY) return;
  await fetch(`${REST}/org_members?org_id=eq.${ORG_A}&user_id=eq.${INVITEE_ID}`, { method: 'DELETE', headers });
}

test.beforeEach(forceEnglish);
test.beforeAll(removeInvitee);
test.afterAll(removeInvitee);

test('an adviser limited to reports, then revoked', async ({ page, browser }) => {
  test.skip(!KEY || !process.env.TEST_INVITEE_EMAIL, 'Needs the local seed and service key');

  await page.goto('/crm/settings/business/access');
  await expect(page.getByRole('heading', { name: 'Roles and access' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Email address').fill(process.env.TEST_INVITEE_EMAIL!);
  await page.getByLabel('Role', { exact: true }).selectOption('adviser');
  await page.getByLabel('Limit to these modules (optional)').check();
  await page.getByLabel('Reports').check();
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = (await page.locator('code').first().textContent())?.trim() ?? '';
  expect(link).toContain('/crm/invite/');

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invitee = await context.newPage();
  await forceEnglish({ page: invitee });
  await invitee.goto(`/login?next=${encodeURIComponent(new URL(link).pathname)}`);
  await invitee.getByPlaceholder('name@example.com').fill(process.env.TEST_INVITEE_EMAIL!);
  await invitee.getByPlaceholder('Enter your password').fill(process.env.TEST_INVITEE_PASSWORD!);
  await invitee.getByRole('button', { name: /log in/i }).click();
  await invitee.waitForURL(/\/crm\/invite\//);
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  await invitee.waitForURL(/\/crm\/dashboard/);
  await context.close();

  await page.reload();
  const row = page.getByRole('listitem').filter({ hasText: 'Adviser' });
  await expect(row).toContainText('Reports');
  await row.getByRole('button', { name: 'Revoke access' }).click();
  await row.getByRole('button', { name: 'Revoke now' }).click();
  await expect(page.getByText('Enter a reason. It is kept in the audit trail.')).toBeVisible();
  await row.getByLabel('Reason').fill('Engagement finished');
  await row.getByRole('button', { name: 'Revoke now' }).click();
  await expect(page.getByRole('heading', { name: 'Access revoked' })).toBeVisible();

  const res = await fetch(`${REST}/sme_audit_events?org_id=eq.${ORG_A}&action=eq.access.member.revoked&select=reason`, { headers });
  expect((await res.json()).map((r: { reason: string }) => r.reason)).toContain('Engagement finished');
});
