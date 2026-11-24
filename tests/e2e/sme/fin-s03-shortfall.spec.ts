/**
 * FIN-S03 (W3a-07): a supplier bill due before an expected customer receipt shows a projected
 * shortage in the right week, with its assumptions; moving the bill in a scenario removes it and
 * leaves the baseline unchanged. The outbox recomputes the baseline after the registers change.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };

const ammanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Week { index: number; start: string; closingMinor: string; lines: Array<{ refId: string | null }> }
interface Run { run: { id: string }; result: { openingClearedMinor: string; firstBelowZeroWeek: number | null; weeks: Week[] } }

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('FIN-S03: a bill due before a customer pays shows a shortfall; a scenario moving it removes it', async ({ page, request }) => {
  test.skip(!KEY || !process.env.CRON_SECRET, 'Needs the local seed, the service key and CRON_SECRET');
  const run = Date.now().toString(36);
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const headers = (key?: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, ...(key ? { 'idempotency-key': `${key}-${run}` } : {}) });
  const post = async <T>(path: string, data: unknown, key: string): Promise<T> => {
    const res = await request.post(`/api/sme/v1/${path}`, { headers: headers(key), data });
    expect(res.ok(), `${path}: ${await res.text()}`).toBe(true);
    return res.json() as Promise<T>;
  };
  const company = async (name: string) => (await (await fetch(`${REST}/crm_companies`, {
    method: 'POST', headers: service, body: JSON.stringify({ org_id: ORG_A, name, created_by: OWNER_A }),
  })).json())[0].id as string;

  const today = ammanToday();
  const before = await post<Run>('forecasts', {}, 'base');
  // Larger than all of Org A's cash, so the week the bill falls due goes below zero.
  const billMinor = BigInt(before.result.openingClearedMinor) + 5_000_000n;
  const billDue = addDays(today, 8);
  const invoiceDue = addDays(today, 22);
  const reference = `FIN-S03-${run}`;
  const line = (minor: bigint) => ({ lines: [{ description: 'FIN-S03', quantity: '1', unit_price_minor: minor.toString(), tax_rate_bp: 0 }], expected: { subtotal_minor: minor.toString(), tax_minor: '0', total_minor: minor.toString() } });

  const bill = await post<{ bill_id: string }>('bills', {
    supplier_company_id: await company(`Amman Supplies ${run}`), supplier_reference: reference, issue_date: today, due_date: billDue, status: 'open', ...line(billMinor),
  }, 'bill');
  const invoice = await post<{ invoice_id: string }>('invoices', {
    customer_company_id: await company(`Al-Noor Trading ${run}`), issue_date: today, due_date: invoiceDue, status: 'open', ...line(billMinor * 2n),
  }, 'inv');
  let scenarioId: string | null = null;

  try {
    // The outbox recomputes the baseline after BillStatusChanged and InvoiceStatusChanged.
    let eventRun: unknown[] = [];
    for (let attempt = 0; attempt < 6 && eventRun.length === 0; attempt++) {
      await request.get('/api/cron/sme-outbox', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
      eventRun = await (await fetch(`${REST}/sme_forecast_runs?org_id=eq.${ORG_A}&scenario_id=is.null&trigger=eq.event&created_at=gt.${encodeURIComponent(new Date(Date.now() - 120_000).toISOString())}&select=id`, { headers: service })).json();
    }
    expect(eventRun.length).toBeGreaterThan(0);

    const after = await post<Run>('forecasts', {}, 'after');
    const short = after.result.firstBelowZeroWeek!;
    expect(short).not.toBeNull();
    expect(after.result.weeks[short].lines.map(l => l.refId)).toContain(bill.bill_id);
    expect(after.result.weeks[short].start <= billDue && billDue <= addDays(after.result.weeks[short].start, 6)).toBe(true);

    await page.goto('/crm/money/forecast');
    const callout = page.getByTestId('forecast-shortfall');
    await expect(callout).toContainText('Cash runs short in the week of', { timeout: 30_000 });
    await callout.getByRole('button', { name: 'Show that week' }).click();
    await expect(page.locator(`#week-lines-${short}`)).toContainText(reference);
    const assumptions = page.getByTestId('forecast-assumptions');
    await expect(assumptions).toContainText('Bills are paid on their due dates.');
    await expect(assumptions).toContainText('No payment history for');

    await assumptions.locator('[data-assumption="bills_on_due_date"]').getByRole('button', { name: 'Change in a scenario' }).click();
    const editor = page.getByTestId('scenario-editor');
    await editor.getByRole('combobox', { name: /^Bill/ }).selectOption(bill.bill_id);
    await editor.getByLabel('New date').fill(addDays(invoiceDue, 1));
    await editor.getByRole('button', { name: 'Add this change' }).click();
    await expect(editor).toContainText(`Bill ${reference} moved to`);
    await editor.getByLabel('Scenario name').fill(`Pay ${reference} later`);
    await editor.getByRole('button', { name: 'Save scenario' }).click();

    const comparison = page.getByTestId('forecast-comparison');
    await expect(comparison.getByTestId('scenario-shortfall')).toHaveText('None', { timeout: 30_000 });
    await expect(callout).toBeVisible();
    scenarioId = await page.getByLabel('Compare with').inputValue();

    const baselineAgain = await post<Run>('forecasts', {}, 'again');
    expect(baselineAgain.run.id).toBe(after.run.id);
    expect(baselineAgain.result.firstBelowZeroWeek).toBe(short);
  } finally {
    await request.post(`/api/sme/v1/bills/${bill.bill_id}/status`, { headers: headers('void-bill'), data: { to: 'void', reason: 'FIN-S03 cleanup' } });
    await request.post(`/api/sme/v1/invoices/${invoice.invoice_id}/status`, { headers: headers('void-inv'), data: { to: 'void', reason: 'FIN-S03 cleanup' } });
    if (scenarioId) await request.post(`/api/sme/v1/scenarios/${scenarioId}/archive`, { headers: headers('arch') });
  }
});
