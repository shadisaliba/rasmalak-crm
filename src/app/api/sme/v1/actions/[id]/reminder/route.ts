import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { INTL_LOCALE, formatMoney, isCurrencyCode, money } from '@/sme/money';
import { reminderBody } from '@/sme/actions/api/schemas';

// The template an organization approves in WhatsApp Business; its parameters are, in order:
// contact name, business name, invoice number, amount, due date.
const TEMPLATE = 'payment_reminder';

// Saves a collection reminder for an overdue invoice as an Outbox draft (rule R17): nothing is sent here.
export const POST = smeRoute<unknown, { id: string }>(async ({ request, db, params, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, reminderBody);
  const { data: action, error } = await db.from('sme_actions').select('subject_type, subject_id').eq('org_id', org).eq('id', uuidParam(params.id)).maybeSingle();
  if (error) throw fromDbError(error);
  if (!action || action.subject_type !== 'invoice' || !action.subject_id) throw new SmeError('NOT_FOUND', { entity: 'invoice' });

  const [invoice, contact, orgRow] = await Promise.all([
    db.from('sme_invoice_balances').select('number, due_date, currency, outstanding_minor::text').eq('org_id', org).eq('invoice_id', action.subject_id).maybeSingle(),
    db.from('crm_contacts').select('first_name, last_name, first_name_ar').eq('org_id', org).eq('id', body.contact_id).maybeSingle(),
    db.from('organizations').select('name, name_ar').eq('id', org).maybeSingle(),
  ]);
  for (const r of [invoice, contact, orgRow]) if (r.error) throw fromDbError(r.error);
  if (!invoice.data || !isCurrencyCode(String(invoice.data.currency))) throw new SmeError('NOT_FOUND', { entity: 'invoice' });
  if (!contact.data) throw new SmeError('NOT_FOUND', { entity: 'contact' });

  const ar = body.language === 'ar';
  const name = ar ? contact.data.first_name_ar || contact.data.first_name : contact.data.first_name;
  const business = (ar ? orgRow.data?.name_ar || orgRow.data?.name : orgRow.data?.name || orgRow.data?.name_ar) ?? '';
  const amount = formatMoney(money(BigInt(String(invoice.data.outstanding_minor)), invoice.data.currency), body.language);
  const due = new Intl.DateTimeFormat(INTL_LOCALE[body.language], { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(`${invoice.data.due_date}T00:00:00Z`));

  const res = await callRpc(db, 'sme_draft_collection_reminder', {
    p_org: org, p_invoice: action.subject_id, p_contact: body.contact_id,
    p_payload: { templateName: TEMPLATE, language: body.language, params: [name, business, String(invoice.data.number), amount, due] },
    p_correlation_id: correlationId, p_idem: key,
  });
  return { status: 201, body: res };
});
