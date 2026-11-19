import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import type { OutboxEvent } from '@/sme/events/types';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { isCurrencyCode } from '@/sme/money';
import { columnMappingSchema, parseOptionsSchema } from '../api/schemas';
import { fileKindOf, isFailure, tableFromFile } from '../domain/file';
import { buildStagedRows } from '../domain/statement';
import { importLimits } from './limits';

const CHUNK_ROWS = 2000;

/**
 * Outbox handler for ImportParseRequested (service role; every query filters by org_id). Any
 * problem with the file fails the batch with no rows visible; only database errors while reading
 * the batch are thrown, so the outbox retries them.
 */
export async function handleImportParseRequested(event: OutboxEvent, db: SupabaseClient = getSupabaseServerClient()): Promise<void> {
  const { batchId } = event.payload as { batchId: string };
  const { data: batch, error } = await db
    .from('sme_import_batches')
    .select('id, account_id, file_name, storage_path, source_hash, byte_size, column_mapping, parse_options, status')
    .eq('org_id', event.orgId).eq('id', batchId).maybeSingle();
  if (error) throw new Error(`import batch read failed: ${error.message}`);
  // A newer parse request, a cancellation or a commit has superseded this event.
  if (!batch || batch.status !== 'parsing') return;

  const fail = async (code: string, detail: Record<string, unknown>) => {
    const { error: failError } = await db.rpc('sme_import_fail', { p_org: event.orgId, p_batch: batchId, p_code: code, p_detail: detail });
    if (failError) throw new Error(`import fail write failed: ${failError.message}`);
  };

  try {
    const mapping = columnMappingSchema.safeParse(batch.column_mapping);
    const options = parseOptionsSchema.safeParse(batch.parse_options);
    if (!mapping.success || !options.success) return await fail('PARSE_FAILED', { reason: 'invalid_mapping' });
    const kind = fileKindOf(batch.file_name);
    if (!kind) return await fail('UNSUPPORTED_FILE_TYPE', { reason: 'file_type' });

    const { data: account } = await db.from('sme_accounts').select('currency').eq('org_id', event.orgId).eq('id', batch.account_id).maybeSingle();
    if (!account || !isCurrencyCode(account.currency)) return await fail('PARSE_FAILED', { reason: 'account' });

    const limits = importLimits();
    if (batch.byte_size > limits.maxBytes) return await fail('FILE_TOO_LARGE', { reason: 'too_large', max_bytes: limits.maxBytes });
    const download = await db.storage.from('sme-imports').download(batch.storage_path);
    if (download.error || !download.data) return await fail('PARSE_FAILED', { reason: 'file_missing' });
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (bytes.byteLength > limits.maxBytes) return await fail('FILE_TOO_LARGE', { reason: 'too_large', max_bytes: limits.maxBytes });
    // The file parsed must be the file the user hashed and the duplicate check used.
    if (createHash('sha256').update(bytes).digest('hex') !== batch.source_hash) return await fail('PARSE_FAILED', { reason: 'hash_mismatch' });

    const file = await tableFromFile(bytes, kind, options.data, limits.maxRows);
    if (isFailure(file)) return await fail(file.code, { reason: file.reason });
    const result = buildStagedRows(file.table, file.firstRowNumber, mapping.data, options.data, {
      currency: account.currency, today: todayInAmman(), maxRows: limits.maxRows,
    });
    if (isFailure(result)) return await fail(result.code, { reason: result.reason });

    for (let i = 0; i < result.rows.length; i += CHUNK_ROWS) {
      const { error: storeError } = await db.rpc('sme_import_store_rows', {
        p_org: event.orgId, p_batch: batchId, p_rows: result.rows.slice(i, i + CHUNK_ROWS), p_final: i + CHUNK_ROWS >= result.rows.length,
      });
      if (storeError) return await fail('PARSE_FAILED', { reason: 'store_failed' });
    }
  } catch (err) {
    console.error('[sme-import] parser exception', { batchId, err });
    await fail('PARSE_FAILED', { reason: 'parser_exception' });
  }
}
