import { createHash } from 'node:crypto';
import { requireUser } from '@/lib/serverAuth';
import { callRpc, correlationIdFrom, idempotencyKeyFrom, orgIdFrom, parseBody } from '@/sme/api/route';
import { SmeError, toResponse } from '@/sme/api/errors';
import { REPORT_CODES, rowCount, toCsv, toXlsx, type ReportCode } from '@/sme/reports/domain/render';
import { buildReport } from '@/sme/reports/server/build';
import { toPdf } from '@/sme/reports/server/pdf';
import { exportBody } from '@/sme/reports/api/schemas';
import { currentMonth } from '@/sme/kpi/server/summary';

const TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

// FIN-06: one report as a file. The export is recorded and audited (sme.reports.export) before the
// file is returned; the figures come from organization-scoped reads under the caller's RLS.
export async function POST(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const correlationId = correlationIdFrom(request);
  try {
    const auth = await requireUser(request);
    if ('error' in auth) return auth.error;
    const { code } = await context.params;
    if (!(REPORT_CODES as readonly string[]).includes(code)) throw new SmeError('NOT_FOUND', { field: 'code' });
    const org = orgIdFrom(request);
    const key = idempotencyKeyFrom(request);
    const body = await parseBody(request, exportBody);
    const period = body.from && body.to ? { from: body.from, to: body.to } : currentMonth();

    const doc = await buildReport(auth.client, org, { code: code as ReportCode, period, locale: body.locale });
    const filters = createHash('sha256').update(JSON.stringify({ code, format: body.format, locale: body.locale, period })).digest('hex');
    await callRpc(auth.client, 'sme_record_export', {
      p_org: org, p_report: code, p_format: body.format, p_filters_digest: filters, p_rows: rowCount(doc), p_correlation_id: correlationId, p_idem: key,
    });
    await auth.client.rpc('sme_track', { p_org: org, p_event: 'ReportExported', p_props: { report: code, format: body.format } });

    const file = body.format === 'csv' ? toCsv(doc) : body.format === 'xlsx' ? toXlsx(doc) : toPdf(doc);
    const name = `rasmalak-${code}-${period.from}-${period.to}.${body.format}`;
    return new Response(new Uint8Array(file), {
      status: 200,
      headers: {
        'content-type': TYPES[body.format],
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        'x-correlation-id': correlationId,
      },
    });
  } catch (err) {
    return toResponse(err, correlationId);
  }
}
