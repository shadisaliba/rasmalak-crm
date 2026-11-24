/**
 * W3a-08 and W3a-10 (FIN-06): the business summary shows every metric with its basis; exports carry
 * their provenance, are audited, and an Org A export never contains Org B rows, even when both
 * organizations have a customer with the same name.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from '../helpers';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const ORG_B = '00000000-0000-4000-b000-00000000000b';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const OWNER_B = 'b0000000-0000-4000-b000-000000000001';
const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const service = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };
const rest = async <T>(path: string, init?: RequestInit): Promise<T> => (await fetch(`${REST}/${path}`, { headers: service, ...init })).json() as Promise<T>;
const ammanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ page }) => {
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
});

test('the summary, the exports and their isolation between organizations', async ({ page, request }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  const run = Date.now().toString(36);
  const today = ammanToday();
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('rasmalak-auth')!).access_token as string);
  const exportReport = (code: string, format: string, locale = 'en', key = `${code}-${format}-${locale}`) => request.post(`/api/sme/v1/reports/${code}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `${key}-${run}` }, data: { format, locale },
  });

  // The same customer name in both organizations, each with its own open invoice.
  const name = `Overlap Trading ${run}`;
  const [companyA] = await rest<Array<{ id: string }>>('crm_companies', { method: 'POST', body: JSON.stringify({ org_id: ORG_A, name, created_by: OWNER_A }) });
  const [companyB] = await rest<Array<{ id: string }>>('crm_companies', { method: 'POST', body: JSON.stringify({ org_id: ORG_B, name, created_by: OWNER_B }) });
  const invoiceA = await request.post('/api/sme/v1/invoices', {
    headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `inv-${run}` },
    data: { number: `ORGA-${run}`, customer_company_id: companyA.id, issue_date: today, due_date: today, status: 'open',
      lines: [{ description: 'Service', quantity: '1', unit_price_minor: '120000', tax_rate_bp: 0 }], expected: { subtotal_minor: '120000', tax_minor: '0', total_minor: '120000' } },
  });
  expect(invoiceA.ok(), await invoiceA.text()).toBe(true);
  const { invoice_id: invoiceAId } = await invoiceA.json() as { invoice_id: string };
  await rest('sme_invoices', { method: 'POST', body: JSON.stringify({
    org_id: ORG_B, number: `ORGB-${run}`, customer_company_id: companyB.id, issue_date: today, due_date: today, currency: 'JOD',
    subtotal_minor: 90000, total_minor: 90000, status: 'open', idempotency_key: `orgb-${run}`, created_by: OWNER_B,
  }) });

  try {
    // An Org A export contains Org A's invoice and none of Org B's.
    const csv = await exportReport('receivables_ageing', 'csv');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const bytes = await csv.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toContain(`ORGA-${run}`);
    expect(text).not.toContain(`ORGB-${run}`);
    expect(text).toContain('Management report. Not a statutory financial statement.');

    // Every format, in both languages, and the export is audited with its filter digest.
    const pdf = await exportReport('cash_summary', 'pdf', 'ar');
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await exportReport('transactions', 'xlsx');
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe('PK');
    const audit = await rest<Array<{ payload: { report: string; format: string; filters_digest: string } }>>(
      `sme_audit_events?org_id=eq.${ORG_A}&action=eq.report.exported&select=payload&order=created_at.desc&limit=3`);
    expect(audit.map(a => `${a.payload.report}.${a.payload.format}`)).toEqual(expect.arrayContaining(['receivables_ageing.csv', 'cash_summary.pdf', 'transactions.xlsx']));
    expect(audit.every(a => /^[0-9a-f]{64}$/.test(a.payload.filters_digest))).toBe(true);

    // The screen: each metric with its basis, and a real download.
    await page.goto('/crm/money/reports');
    const grid = page.getByTestId('kpi-grid');
    await expect(grid.locator('[data-metric="cleared_cash"]')).toContainText('JOD', { timeout: 30_000 });
    await expect(grid.locator('[data-metric="revenue_recognized"]')).toContainText('A receipt matched to an invoice is not counted twice.');
    await expect(grid.locator('[data-metric="profit_estimate"]')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.locator('[data-report="payables_due"]').getByRole('button', { name: 'PDF' }).click();
    expect((await downloading).suggestedFilename()).toMatch(/^rasmalak-payables_due-.*\.pdf$/);
  } finally {
    await request.post(`/api/sme/v1/invoices/${invoiceAId}/status`, { headers: { Authorization: `Bearer ${token}`, 'x-org-id': ORG_A, 'idempotency-key': `void-${run}` }, data: { to: 'void', reason: 'W3a-10 cleanup' } });
    await rest(`sme_invoices?org_id=eq.${ORG_B}&number=eq.ORGB-${run}`, { method: 'PATCH', body: JSON.stringify({ status: 'void', status_reason: 'W3a-10 cleanup' }) });
  }
});
