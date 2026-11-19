import { z } from 'zod';
import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, parseQuery, smeRoute } from '@/sme/api/route';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { createBatchInput } from '@/sme/imports/api/schemas';
import { importLimits } from '@/sme/imports/server/limits';

const listQuery = z.object({ account: z.uuid().optional() });

export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { account } = parseQuery(request, listQuery);
  let query = db.from('sme_import_batches')
    .select('id, account_id, file_name, status, row_count, accepted_count, excluded_count, error_code, created_at, committed_at')
    .eq('org_id', org).order('created_at', { ascending: false }).limit(20);
  if (account) query = query.eq('account_id', account);
  const { data, error } = await query;
  if (error) throw fromDbError(error);
  return { body: { items: data ?? [] } };
});

// Creates the batch (duplicate files are refused here, before any parsing) and returns a signed
// URL for uploading the file to its private path.
export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const input = await parseBody(request, createBatchInput);
  const { maxBytes } = importLimits();
  if (input.byte_size > maxBytes) throw new SmeError('FILE_TOO_LARGE', { max_bytes: maxBytes });

  const batch = await callRpc<{ batch_id: string; storage_path: string; mime_type: string; file_kind: string }>(db, 'sme_create_import_batch', {
    p_org: org, p_account: input.account_id,
    p_file: { file_name: input.file_name, byte_size: input.byte_size, sha256: input.sha256.toLowerCase(), mime_type: input.mime_type },
    p_correlation_id: correlationId, p_idem: key,
  });
  const { data: upload, error } = await db.storage.from('sme-imports').createSignedUploadUrl(batch.storage_path);
  if (error || !upload) {
    console.error('[sme-import] signed upload URL failed', { correlationId, error });
    throw new SmeError('INTERNAL');
  }
  return { status: 201, body: { ...batch, upload: { path: upload.path, token: upload.token } } };
});
