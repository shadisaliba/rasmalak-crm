/**
 * W0-10: automation messages wait in the Outbox until a person approves them; the worker sends
 * only approved drafts.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const ids: string[] = [];

async function draft(row: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${REST}/crm_outbound_drafts`, { method: 'POST', headers, body: JSON.stringify({ org_id: ORG_A, ...row }) });
  const [created] = await res.json();
  ids.push(created.id);
  return created.id;
}
async function status(id: string): Promise<string> {
  const res = await fetch(`${REST}/crm_outbound_drafts?id=eq.${id}&select=status`, { headers });
  return (await res.json())[0].status;
}

test.beforeEach(forceEnglish);
test.afterAll(async () => {
  for (const id of ids) await fetch(`${REST}/crm_outbound_drafts?id=eq.${id}`, { method: 'DELETE', headers });
});

test('a draft is sent only after a person approves it', async ({ page, request }) => {
  test.skip(!KEY || !process.env.CRON_SECRET, 'Needs SUPABASE_SERVICE_ROLE_KEY and CRON_SECRET');
  const slackId = await draft({ channel: 'slack', recipient: 'C-E2E', payload: { message: 'Overdue invoice reminder (e2e)' } });
  const emailId = await draft({ channel: 'email', recipient: '00000000-0000-4000-8000-000000000000', payload: { subject: 'E2E email subject' } });

  // The worker ignores drafts nobody has approved.
  await request.get('/api/automation/scheduled', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(await status(slackId)).toBe('draft');

  await page.goto('/crm/automation');
  await page.getByRole('button', { name: 'Outbox' }).click();
  const slackRow = page.getByRole('listitem').filter({ hasText: 'Overdue invoice reminder (e2e)' });
  await expect(slackRow).toBeVisible({ timeout: 15_000 });

  const emailRow = page.getByRole('listitem').filter({ hasText: 'E2E email subject' });
  await expect(emailRow.getByRole('button', { name: 'Approve and send' })).toHaveCount(0);
  await expect(emailRow.getByRole('button', { name: 'Discard' })).toBeVisible();

  await slackRow.getByRole('button', { name: 'Approve and send' }).click();
  await expect(page.getByText('Approved, sending shortly')).toBeVisible();
  expect(await status(slackId)).toBe('approved');

  // No Slack connection in the test org, so the worker records an honest failure.
  await request.get('/api/automation/scheduled', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(await status(slackId)).toBe('failed');
  await page.reload();
  await page.getByRole('button', { name: 'Outbox' }).click();
  await expect(page.getByText('No active Slack connection')).toBeVisible({ timeout: 15_000 });
  expect(await status(emailId)).toBe('draft');
});
