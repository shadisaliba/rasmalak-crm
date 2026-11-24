-- ============================================================
-- SME REPORT EXPORTS (W3a-10, FIN-06): permission and audit for every export
-- ============================================================
-- Reports are built in the app from organization-scoped reads. This records the export first, in
-- one transaction with its audit event (R12), and refuses anyone without sme.reports.export.

create or replace function sme_record_export(p_org uuid, p_report text, p_format text, p_filters_digest text, p_rows int,
                                             p_correlation_id uuid, p_idem text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_replay jsonb;
  v_request jsonb := jsonb_build_object('report', p_report, 'format', p_format, 'filters', p_filters_digest, 'rows', p_rows);
  v_response jsonb;
begin
  perform sme_require(p_org, 'sme.reports.export');
  if p_report not in ('cash_summary', 'income_expense', 'receivables_ageing', 'payables_due', 'transactions') then
    perform sme_fail('VALIDATION_FAILED', '{"field":"report"}');
  end if;
  if p_format not in ('csv', 'xlsx', 'pdf') then perform sme_fail('VALIDATION_FAILED', '{"field":"format"}'); end if;
  if p_filters_digest !~ '^[0-9a-f]{64}$' or p_rows is null or p_rows < 0 then
    perform sme_fail('VALIDATION_FAILED', '{"field":"filters"}');
  end if;

  v_replay := sme_idem_begin(p_org, p_idem, 'reports.export', v_request);
  if v_replay is not null then return v_replay; end if;

  perform sme_audit(p_org, 'report.exported', 'report', null, null, null,
    jsonb_build_object('report', p_report, 'format', p_format, 'filters_digest', p_filters_digest, 'rows', p_rows), p_correlation_id);

  v_response := jsonb_build_object('exported_at', now());
  perform sme_idem_finish(p_org, p_idem, 'reports.export', v_request, v_response);
  return v_response;
end;
$$;

revoke all on function sme_record_export(uuid, text, text, text, int, uuid, text) from public, anon;
grant execute on function sme_record_export(uuid, text, text, text, int, uuid, text) to authenticated;
