/**
 * Sends drafts a person has approved (rule R17). Runs in the automation cron with the service role.
 */
import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import { postSlackMessage, postWebhook, sendWhatsAppTemplateToContact, type SendOutcome } from './outboundSenders';

interface DraftRow {
  id: string;
  org_id: string;
  channel: 'email' | 'whatsapp' | 'slack' | 'webhook';
  recipient: string;
  payload: Record<string, unknown>;
  decided_by: string | null;
}

async function deliver(draft: DraftRow): Promise<SendOutcome> {
  const p = draft.payload;
  switch (draft.channel) {
    case 'slack':
      return postSlackMessage(draft.org_id, draft.recipient, String(p.message ?? ''));
    case 'webhook':
      return postWebhook(draft.recipient, (p.headers as Record<string, string>) ?? {}, p.body ?? {});
    case 'whatsapp': {
      const sent = await sendWhatsAppTemplateToContact(draft.org_id, draft.recipient, {
        name: String(p.templateName ?? ''),
        language: String(p.language ?? 'ar'),
        params: Array.isArray(p.params) ? p.params.map(String) : [],
      });
      if (sent.ok && draft.decided_by) {
        await serviceDb().from('crm_communications').insert({
          org_id: draft.org_id,
          contact_id: draft.recipient,
          type: 'whatsapp',
          direction: 'outbound',
          body: `[template] ${String(p.templateName ?? '')}`,
          logged_by: draft.decided_by,
        });
      }
      return sent;
    }
    case 'email':
      return { ok: false, error: 'Email sending is not connected yet' };
  }
}

export async function processApprovedDrafts(limit = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const { data: drafts } = await serviceDb()
    .from('crm_outbound_drafts')
    .select('id, org_id, channel, recipient, payload, decided_by')
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .limit(limit);

  for (const draft of (drafts ?? []) as DraftRow[]) {
    // Claim by moving to sent first: if two workers overlap only one wins, and a crash after the
    // claim errs on the side of not sending twice.
    const { data: claimed } = await serviceDb()
      .from('crm_outbound_drafts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', draft.id)
      .eq('org_id', draft.org_id)
      .eq('status', 'approved')
      .select('id');
    if (!claimed?.length) continue;

    const outcome = await deliver(draft);
    if (outcome.ok) {
      sent++;
    } else {
      failed++;
      await serviceDb()
        .from('crm_outbound_drafts')
        .update({ status: 'failed', sent_at: null, last_error: outcome.error.slice(0, 500) })
        .eq('id', draft.id)
        .eq('org_id', draft.org_id);
    }
  }
  return { sent, failed };
}
