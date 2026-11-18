/**
 * Delivery for outbound automation messages. Used for workflows that do not require
 * confirmation (Slack and webhooks only) and by the outbox worker for approved drafts.
 */
import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import { sendTemplateMessage } from '@/integrations/adapters/whatsappBusiness';

export type SendOutcome = { ok: true; details?: Record<string, unknown> } | { ok: false; error: string };

export async function postSlackMessage(orgId: string, channelId: string, message: string): Promise<SendOutcome> {
  const { data: conn } = await serviceDb()
    .from('service_connections')
    .select('id, access_token')
    .eq('org_id', orgId)
    .eq('provider', 'slack')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (!conn) return { ok: false, error: 'No active Slack connection' };

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${conn.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, text: message }),
    });
    const result = await res.json();
    return result.ok ? { ok: true, details: { channelId } } : { ok: false, error: String(result.error ?? 'Slack API error') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Slack API error' };
  }
}

// SSRF guard: automation must not reach the platform's own network.
export function webhookTargetError(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') || hostname.startsWith('172.') ||
        hostname === '[::1]' || hostname.endsWith('.internal')) {
      return 'URL targets a private network — blocked';
    }
    return null;
  } catch {
    return 'Invalid URL';
  }
}

export async function postWebhook(url: string, headers: Record<string, string>, body: unknown): Promise<SendOutcome> {
  const blocked = webhookTargetError(url);
  if (blocked) return { ok: false, error: blocked };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true, details: { url } } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Webhook error' };
  }
}

export async function sendWhatsAppTemplateToContact(
  orgId: string,
  contactId: string,
  template: { name: string; language: string; params: string[] },
): Promise<SendOutcome> {
  const [{ data: contact }, { data: account }] = await Promise.all([
    serviceDb().from('crm_contacts').select('whatsapp_number, phone').eq('id', contactId).eq('org_id', orgId).maybeSingle(),
    serviceDb().from('whatsapp_accounts').select('id').eq('org_id', orgId).eq('status', 'active').limit(1).maybeSingle(),
  ]);
  const to = contact?.whatsapp_number || contact?.phone;
  if (!to) return { ok: false, error: 'Contact has no WhatsApp number' };
  if (!account) return { ok: false, error: 'No active WhatsApp account' };

  const sent = await sendTemplateMessage({
    orgId,
    accountId: account.id,
    to,
    templateName: template.name,
    language: template.language,
    components: template.params.length
      ? [{ type: 'body', parameters: template.params.map(text => ({ type: 'text' as const, text })) }]
      : undefined,
  });
  return sent ? { ok: true, details: { messageId: sent.messageId, to } } : { ok: false, error: 'WhatsApp send failed' };
}
