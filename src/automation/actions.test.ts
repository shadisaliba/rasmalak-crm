import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];

// Minimal chainable stand-in for the Supabase query builder.
function query(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ['select', 'eq', 'limit', 'order', 'in']) chain[m] = self;
  chain.insert = (row: Record<string, unknown>) => { inserted.push({ table, row }); return chain; };
  chain.single = async () => ({ data: { id: 'draft-1' }, error: null });
  chain.maybeSingle = async () => ({ data: table === 'service_connections' ? { id: 'conn', access_token: 'xoxb' } : null, error: null });
  return chain;
}
vi.mock('@/lib/supabaseServer', () => ({ serviceDb: () => ({ from: query }) }));

const whatsapp = { sendTemplateMessage: vi.fn(), sendTextMessage: vi.fn() };
vi.mock('@/integrations/adapters/whatsappBusiness', () => whatsapp);

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
vi.stubGlobal('fetch', fetchSpy);

const { executeAction, isSmeTrigger } = await import('./actions');

const baseCtx = {
  orgId: '00000000-0000-4000-a000-00000000000a',
  entityType: 'contact',
  entityId: '11111111-1111-4111-8111-111111111111',
  entityData: { name: 'Lina' },
  workflowId: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  inserted.length = 0;
  whatsapp.sendTemplateMessage.mockReset();
  whatsapp.sendTextMessage.mockReset();
  fetchSpy.mockClear();
});

describe('outbound automation actions', () => {
  it('treats sme_* and sme.* triggers as SME-originated', () => {
    expect(isSmeTrigger('sme_invoice_overdue')).toBe(true);
    expect(isSmeTrigger('sme.forecast_shortfall')).toBe(true);
    expect(isSmeTrigger('deal_created')).toBe(false);
  });

  it('an SME-originated send_whatsapp produces a draft and calls no adapter', async () => {
    const result = await executeAction(
      { type: 'send_whatsapp', config: { templateName: 'payment_reminder', templateParams: ['{{name}}'] } },
      { ...baseCtx, requiresConfirmation: isSmeTrigger('sme_invoice_overdue') },
    );
    expect(result).toMatchObject({ success: true, details: { draftId: 'draft-1', status: 'draft' } });
    expect(inserted).toEqual([{ table: 'crm_outbound_drafts', row: expect.objectContaining({ channel: 'whatsapp', recipient: baseCtx.entityId, payload: { templateName: 'payment_reminder', language: 'ar', params: ['Lina'] } }) }]);
    expect(whatsapp.sendTemplateMessage).not.toHaveBeenCalled();
    expect(whatsapp.sendTextMessage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('email and WhatsApp wait for a person even when confirmation is not required', async () => {
    await executeAction({ type: 'send_email', config: { subject: 'Hi {{name}}', body: 'x' } }, { ...baseCtx, requiresConfirmation: false });
    await executeAction({ type: 'send_whatsapp', config: { templateName: 't' } }, { ...baseCtx, requiresConfirmation: false });
    expect(inserted.map(i => [i.table, i.row.channel])).toEqual([['crm_outbound_drafts', 'email'], ['crm_outbound_drafts', 'whatsapp']]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Slack and webhooks become drafts when confirmation is required', async () => {
    await executeAction({ type: 'send_slack', config: { channelId: 'C1', message: 'Deal {{name}}' } }, { ...baseCtx, requiresConfirmation: true });
    await executeAction({ type: 'webhook', config: { url: 'https://example.com/hook' } }, { ...baseCtx, requiresConfirmation: true });
    expect(inserted.map(i => i.row.channel)).toEqual(['slack', 'webhook']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Slack still posts directly when the workflow does not require confirmation', async () => {
    const result = await executeAction({ type: 'send_slack', config: { channelId: 'C1', message: 'hi' } }, { ...baseCtx, requiresConfirmation: false });
    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(inserted).toEqual([]);
  });

  it('refuses webhooks to private networks before drafting', async () => {
    const result = await executeAction({ type: 'webhook', config: { url: 'http://10.0.0.5/x' } }, { ...baseCtx, requiresConfirmation: true });
    expect(result.success).toBe(false);
    expect(inserted).toEqual([]);
  });
});
