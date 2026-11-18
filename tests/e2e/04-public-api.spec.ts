/**
 * W0-05: the public API runs with the service role, so tenant isolation rests entirely on the
 * org_id filters in each route. For every route, an Org A key must not read, change or delete
 * Org B records, and must not be able to create records inside Org B.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

const ORG_A = '00000000-0000-4000-a000-00000000000a';
const ORG_B = '00000000-0000-4000-b000-00000000000b';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';
const OWNER_B = 'b0000000-0000-4000-b000-000000000001';

const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

async function rest<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T[]> {
  const res = await fetch(`${REST}/${path}`, { ...init, headers: { ...serviceHeaders, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}
const insert = async (table: string, row: Record<string, unknown>) => (await rest<{ id: string }>(table, { method: 'POST', body: JSON.stringify(row) }))[0];

async function createApiKey(orgId: string, createdBy: string): Promise<{ id: string; token: string }> {
  const token = `rk_${randomBytes(24).toString('hex')}`;
  const row = await insert('api_keys', {
    org_id: orgId, name: 'e2e isolation', key_prefix: token.slice(0, 8), created_by: createdBy,
    key_hash: createHash('sha256').update(token).digest('hex'), rate_limit: 10_000,
  });
  return { id: row.id, token };
}

const b: Record<string, string> = {};
let keyA = { id: '', token: '' };
let keyB = { id: '', token: '' };
const created: Array<[string, string]> = [];

test.beforeAll(async () => {
  test.skip(!SERVICE_KEY || !process.env.SUPABASE_URL, 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  keyA = await createApiKey(ORG_A, OWNER_A);
  keyB = await createApiKey(ORG_B, OWNER_B);
  const [pipeline] = await rest<{ id: string }>(`crm_pipelines?org_id=eq.${ORG_B}&select=id&limit=1`);
  const [stage] = await rest<{ id: string }>(`crm_deal_stages?pipeline_id=eq.${pipeline.id}&select=id&order=position&limit=1`);
  const [contact] = await rest<{ id: string }>(`crm_contacts?org_id=eq.${ORG_B}&select=id&limit=1`);
  b.pipeline = pipeline.id;
  b.contact = contact.id;
  b.company = (await insert('crm_companies', { org_id: ORG_B, name: 'B isolation co', created_by: OWNER_B })).id;
  b.deal = (await insert('crm_deals', { org_id: ORG_B, pipeline_id: pipeline.id, stage_id: stage.id, title: 'B isolation deal', created_by: OWNER_B })).id;
  b.task = (await insert('crm_tasks', { org_id: ORG_B, title: 'B isolation task', created_by: OWNER_B })).id;
  b.communication = (await insert('crm_communications', { org_id: ORG_B, contact_id: contact.id, type: 'note', body: 'B isolation note', logged_by: OWNER_B })).id;
  b.webhook = (await insert('api_webhook_subscriptions', { org_id: ORG_B, api_key_id: keyB.id, url: 'https://example.test/b', event_types: ['contact.created'], secret: 's' })).id;
  created.push(['crm_companies', b.company], ['crm_deals', b.deal], ['crm_tasks', b.task], ['crm_communications', b.communication],
    ['api_webhook_subscriptions', b.webhook], ['api_keys', keyA.id], ['api_keys', keyB.id]);
});

test.afterAll(async () => {
  for (const [table, id] of created.reverse()) await rest(`${table}?id=eq.${id}`, { method: 'DELETE' }).catch(() => undefined);
});

const asA = () => ({ Authorization: `Bearer ${keyA.token}` });

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(path, { headers: asA() });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

function expectNoOrgB(rows: Array<Record<string, unknown>>) {
  const leaked = rows.filter(r => r.org_id === ORG_B || Object.values(b).includes(r.id as string));
  expect(leaked).toEqual([]);
}

for (const path of ['/api/crm/v1/contacts', '/api/crm/v1/companies', '/api/crm/v1/deals', '/api/crm/v1/tasks', '/api/crm/v1/communications', '/api/crm/v1/pipelines', '/api/crm/v1/webhooks']) {
  test(`GET ${path} lists no Org B rows`, async ({ request }) => {
    const { status, body } = await getJson(request, path);
    expect(status).toBe(200);
    expectNoOrgB(body.data);
  });
}

for (const [resource, key] of [['contacts', 'contact'], ['companies', 'company'], ['deals', 'deal'], ['tasks', 'task']] as const) {
  test(`/api/crm/v1/${resource}/[id] cannot read, change or delete an Org B record`, async ({ request }) => {
    const path = `/api/crm/v1/${resource}/${b[key]}`;
    expect((await request.get(path, { headers: asA() })).status()).toBe(404);
    expect((await request.patch(path, { headers: asA(), data: { title: 'pwned', notes: 'pwned' } })).status()).not.toBe(200);
    await request.delete(path, { headers: asA() });
    const table = { contacts: 'crm_contacts', companies: 'crm_companies', deals: 'crm_deals', tasks: 'crm_tasks' }[resource];
    const [row] = await rest<Record<string, unknown>>(`${table}?id=eq.${b[key]}&select=*`);
    expect(row, 'Org B row still exists').toBeTruthy();
    expect(row.org_id).toBe(ORG_B);
    expect(row.title ?? null).not.toBe('pwned');
    expect(row.notes ?? null).not.toBe('pwned');
  });
}

test('GET /api/crm/v1/pipelines/[id]/stages refuses an Org B pipeline', async ({ request }) => {
  expect((await getJson(request, `/api/crm/v1/pipelines/${b.pipeline}/stages`)).status).toBe(404);
});

test('DELETE /api/crm/v1/webhooks cannot remove an Org B subscription', async ({ request }) => {
  await request.delete(`/api/crm/v1/webhooks?id=${b.webhook}`, { headers: asA() });
  expect(await rest(`api_webhook_subscriptions?id=eq.${b.webhook}&select=id`)).toHaveLength(1);
});

test('POST routes create records in the key\'s own organization even when the body names another', async ({ request }) => {
  const res = await request.post('/api/crm/v1/tasks', { headers: asA(), data: { org_id: ORG_B, title: 'A isolation task' } });
  expect(res.status()).toBe(201);
  const { data } = await res.json();
  created.push(['crm_tasks', data.id]);
  expect(data.org_id).toBe(ORG_A);
});

test('an invalid key is refused', async ({ request }) => {
  const res = await request.get('/api/crm/v1/contacts', { headers: { Authorization: 'Bearer rk_not_a_real_key' } });
  expect(res.status()).toBe(401);
});
