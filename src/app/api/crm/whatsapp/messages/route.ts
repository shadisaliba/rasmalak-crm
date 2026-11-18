/**
 * POST /api/crm/whatsapp/messages
 * Sends a WhatsApp text the signed-in user typed and clicked Send on, then logs it.
 * The account's access token is decrypted here, never in the browser.
 */
import { NextResponse } from 'next/server';
import { requireUser, requireOrgPermission } from '@/lib/serverAuth';
import { errorResponse } from '@/lib/apiError';
import { sendTextMessage } from '@/integrations/adapters/whatsappBusiness';

interface SendBody {
  orgId: string;
  accountId: string;
  contactId: string;
  to: string;
  text: string;
}

function parseBody(value: unknown): SendBody | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const fields = ['orgId', 'accountId', 'contactId', 'to', 'text'] as const;
  if (!fields.every(f => typeof v[f] === 'string' && (v[f] as string).trim() !== '')) return null;
  return { orgId: v.orgId as string, accountId: v.accountId as string, contactId: v.contactId as string, to: v.to as string, text: (v.text as string).trim().slice(0, 4096) };
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ('error' in auth) return auth.error;

  const body = parseBody(await request.json().catch(() => null));
  if (!body) return errorResponse('VALIDATION_FAILED');

  const denied = await requireOrgPermission(auth.client, body.orgId, 'contacts.write');
  if (denied) return denied.error;

  // Both checks run as the caller, so RLS confirms the account and contact belong to this organization.
  const [{ data: account }, { data: contact }] = await Promise.all([
    auth.client.from('whatsapp_accounts').select('id').eq('id', body.accountId).eq('org_id', body.orgId).maybeSingle(),
    auth.client.from('crm_contacts').select('id').eq('id', body.contactId).eq('org_id', body.orgId).maybeSingle(),
  ]);
  if (!account || !contact) return errorResponse('NOT_FOUND');

  const sent = await sendTextMessage({ orgId: body.orgId, accountId: body.accountId, to: body.to, text: body.text }, auth.client);
  if (!sent) return errorResponse('INTERNAL', { reason: 'send_failed' });

  const { error: logError } = await auth.client.from('crm_communications').insert({
    org_id: body.orgId,
    contact_id: body.contactId,
    type: 'whatsapp',
    direction: 'outbound',
    body: body.text,
    logged_by: auth.userId,
  });
  if (logError) console.warn('[whatsapp/messages] sent but not logged:', logError.message);

  return NextResponse.json({ data: { messageId: sent.messageId } });
}
