import { orgIdFrom, smeRoute, uuidParam } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';

export const GET = smeRoute<unknown, { id: string }>(async ({ request, db, params }) => {
  const org = orgIdFrom(request);
  const id = uuidParam(params.id);
  const { data: batch, error } = await db.from('sme_import_batches')
    .select('id, account_id, file_name, mime_type, byte_size, status, column_mapping, parse_options, row_count, accepted_count, excluded_count, error_code, error_detail, created_at, committed_at, committed_by, uploaded_by')
    .eq('org_id', org).eq('id', id).maybeSingle();
  if (error) throw fromDbError(error);
  if (!batch) throw new SmeError('NOT_FOUND', { entity: 'import_batch' });
  const [{ data: account }, { data: summary, error: summaryError }] = await Promise.all([
    db.from('sme_accounts').select('id, name, name_ar, currency').eq('org_id', org).eq('id', batch.account_id).maybeSingle(),
    db.rpc('sme_import_summary', { p_batch: id }),
  ]);
  if (summaryError) throw fromDbError(summaryError);
  return { body: { batch, account, summary } };
});
