/**
 * W0-04: joining an organization only through an invitation link.
 * The owner (saved session) invites a seeded user; that user signs in through the
 * redirect, accepts, and a second use of the same link is refused.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const INVITEE_ID = 'e0000000-0000-4000-e000-000000000001';

async function removeInviteeMembership() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/org_members?org_id=eq.${ORG_A}&user_id=eq.${INVITEE_ID}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
}

test.beforeEach(forceEnglish);
test.beforeAll(removeInviteeMembership);
test.afterAll(removeInviteeMembership);

test('an invitation link adds the invited person with the invited role, once', async ({ page, browser }) => {
  const email = process.env.TEST_INVITEE_EMAIL;
  const password = process.env.TEST_INVITEE_PASSWORD;
  test.skip(!email || !password, 'Set TEST_INVITEE_EMAIL and TEST_INVITEE_PASSWORD');

  await page.goto('/crm/settings/team');
  await page.getByRole('button', { name: 'Invite Member' }).click();
  await page.getByLabel('Email address').fill(email!);
  await page.getByLabel('Role', { exact: true }).selectOption('sales_rep');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = (await page.locator('code').first().textContent())?.trim() ?? '';
  expect(link).toMatch(/\/crm\/invite\/[0-9a-f]{64}$/);
  await expect(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const invitee = await context.newPage();
  await forceEnglish({ page: invitee });
  await invitee.goto(link);
  await invitee.waitForURL(/\/login\?next=%2Fcrm%2Finvite%2F/, { timeout: 15_000 });
  await invitee.getByPlaceholder('name@example.com').fill(email!);
  await invitee.getByPlaceholder('Enter your password').fill(password!);
  await invitee.getByRole('button', { name: /log in/i }).click();
  await invitee.waitForURL(/\/crm\/invite\//, { timeout: 15_000 });

  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  await invitee.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });

  await invitee.goto(link);
  await invitee.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(invitee.getByText('This invitation has already been used.')).toBeVisible();
  await context.close();

  await page.reload();
  await expect(page.getByText('sales_rep').first()).toBeVisible({ timeout: 15_000 });
});

test('the role picker only offers roles the inviter may grant', async ({ page }) => {
  await page.goto('/crm/settings/team');
  await page.getByRole('button', { name: 'Invite Member' }).click();
  const options = await page.getByLabel('Role', { exact: true }).locator('option').allTextContents();
  // The saved session is the owner, who may grant every role including admin.
  expect(options).toEqual(expect.arrayContaining(['admin', 'manager', 'sales_rep', 'viewer']));
});
