/**
 * W3a-09 (F1.11): evaluating twice creates no duplicate action or notification; an action shows
 * the figures behind it with a link to their source; a reminder is only a draft until a person
 * sends it; an action resolves itself when its condition clears.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };
const rest = async <T>(path: string, init?: RequestInit): Promise<T> => (await fetch(`${REST}/${path}`, { headers: service, ...init })).json() as Promise<T>;

const ammanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('an overdue invoice becomes one action with its figures, a draft reminder, and clears itself', async ({ page, request }) => {
  test.skip(!KEY || !process.env.CRON_SECRET, 'Needs the local seed, the service key and CRON_SECRET');
  // Three full evaluations of Org A run in this test.
  test.setTimeout(120_000);
  const run = Date.now().toString(36);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const headers = (key: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `${key}-${run}` });
  const daily = () => request.get('/api/cron/sme-daily', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });

  const customer = `Late Payer ${run}`;
  const [company] = await rest<Array<{ id: string }>>('crm_companies', { method: 'POST', body: JSON.stringify({ org_id: ORG_A, name: customer, created_by: OWNER_A }) });
  await rest('crm_contacts', { method: 'POST', body: JSON.stringify({ org_id: ORG_A, company_id: company.id, first_name: 'Huda', phone: '0791234567', created_by: OWNER_A }) });
  const today = ammanToday();
  const created = await request.post('/api/sme/v1/invoices', {
    headers: headers('inv'),
    data: {
      customer_company_id: company.id, issue_date: addDays(today, -40), due_date: addDays(today, -12), status: 'open',
      lines: [{ description: 'Catering', quantity: '1', unit_price_minor: '750000', tax_rate_bp: 0 }],
      expected: { subtotal_minor: '750000', tax_minor: '0', total_minor: '750000' },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const invoice = (await created.json()) as { invoice_id: string; number: string };
  const dedupe = `receivable_overdue:${invoice.invoice_id}`;

  try {
    // Re-running the evaluation twice creates no duplicate action or notification.
    expect((await daily()).ok()).toBe(true);
    expect((await daily()).ok()).toBe(true);
    const actions = await rest<Array<{ id: string; status: string }>>(`sme_actions?org_id=eq.${ORG_A}&dedupe_key=eq.${dedupe}&select=id,status`);
    expect(actions).toHaveLength(1);
    const notifications = await rest<unknown[]>(`crm_notifications?org_id=eq.${ORG_A}&entity_id=eq.${actions[0].id}&select=id`);
    const owners = await rest<unknown[]>(`org_members?org_id=eq.${ORG_A}&role=in.(owner,admin)&select=user_id`);
    expect(notifications).toHaveLength(owners.length);

    // The action shows the numbers that triggered it and links to their source.
    await page.goto('/crm/money/actions');
    const card = page.getByTestId('action-card').filter({ hasText: customer });
    await expect(card).toContainText(`${customer} owes you JOD 750.000, 12 days late`, { timeout: 30_000 });
    await expect(card).toContainText('Still owed');
    await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/crm/money/receivables/${invoice.invoice_id}`);

    // No message is sent without a click: the reminder is a draft, or opens the owner's own WhatsApp.
    await card.getByRole('button', { name: 'Send a reminder' }).click();
    const panel = card.getByTestId('reminder-panel');
    await expect(panel.getByTestId('reminder-text')).toContainText(invoice.number, { timeout: 15_000 });
    await expect(panel.getByRole('link', { name: 'Open in WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/962791234567\?text=/);
    await panel.getByRole('button', { name: 'Save to the Outbox for approval' }).click();
    await expect(panel).toContainText('Saved in the Outbox');
    const drafts = await rest<Array<{ status: string; channel: string }>>(`crm_outbound_drafts?org_id=eq.${ORG_A}&entity_id=eq.${invoice.invoice_id}&select=status,channel`);
    expect(drafts).toEqual([{ status: 'draft', channel: 'whatsapp' }]);

    await card.getByRole('button', { name: 'Remind me later' }).click();
    await card.getByRole('button', { name: 'Tomorrow' }).click();
    await expect(page.getByTestId('action-card').filter({ hasText: customer })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Later' }).click();
    await expect(page.getByTestId('action-card').filter({ hasText: customer })).toContainText('Back on');
  } finally {
    await request.post(`/api/sme/v1/invoices/${invoice.invoice_id}/status`, { headers: headers('void'), data: { to: 'void', reason: 'W3a-09 cleanup' } });
  }

  // Once the invoice no longer needs collecting, the action resolves itself, with the reason.
  expect((await daily()).ok()).toBe(true);
  const after = await rest<Array<{ status: string; decision_reason: string }>>(`sme_actions?org_id=eq.${ORG_A}&dedupe_key=eq.${dedupe}&select=status,decision_reason`);
  expect(after).toEqual([{ status: 'resolved', decision_reason: 'condition_cleared' }]);
});
