-- W2-06 (FIN-S01): duplicate files are refused before parsing, overlapping rows are suspected
-- duplicates, a commit posts all accepted rows or none, and a batch commits once.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

create schema tests;
grant usage on schema tests to authenticated, service_role;
create function tests.act_as(p_user uuid) returns void language sql security definer as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
grant execute on function tests.act_as(uuid) to authenticated;
create table tests.ids (k text primary key, v uuid);
grant all on tests.ids to authenticated, service_role;
create function tests.id(p text) returns uuid language sql stable as $$ select v from tests.ids where k = p $$;
grant execute on function tests.id(text) to authenticated, service_role;
create function tests.row(n int, d text, amt text, descr text, ref text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('row_number', n, 'value_date', d, 'amount_minor', amt, 'description', descr, 'external_ref', ref,
                            'raw', jsonb_build_object('line', n), 'issues', '[]'::jsonb)
$$;
grant execute on function tests.row(int, text, text, text, text) to authenticated, service_role;

set local role authenticated;
select tests.act_as('a0000000-0000-4000-a000-000000000001');
insert into tests.ids select 'acct', (sme_create_account('00000000-0000-4000-a000-00000000000a',
  '{"kind":"bank","name":"Import bank","currency":"JOD"}', null, null, 'imp-acc') ->> 'account_id')::uuid;

-- ── Create and storage ──────────────────────────────────────
insert into tests.ids select 'b1', (sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'كشف أكتوبر.csv', 'byte_size', 2048, 'sha256', repeat('a', 64), 'mime_type', 'text/csv'), null, 'imp-b1') ->> 'batch_id')::uuid;
select matches((select storage_path from sme_import_batches where id = tests.id('b1')), '^00000000-0000-4000-a000-00000000000a/[0-9a-f-]{36}/[A-Za-z0-9._-]+$',
  'the object path is organization/batch/sanitized name');
select throws_ok($$ select sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'again.csv', 'byte_size', 2048, 'sha256', repeat('a', 64), 'mime_type', 'text/csv'), null, 'imp-b1-again') $$,
  'P0001', 'DUPLICATE_IMPORT', 'the same file for the same account is refused before any parsing');
select throws_ok($$ select sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'statement.pdf', 'byte_size', 10, 'sha256', repeat('c', 64), 'mime_type', 'application/pdf'), null, 'imp-pdf') $$,
  'P0001', 'UNSUPPORTED_FILE_TYPE', 'only CSV and XLSX are accepted');

select lives_ok($$ insert into storage.objects (bucket_id, name) select 'sme-imports', storage_path from sme_import_batches where id = tests.id('b1') $$,
  'the uploader can put the file at its batch path');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('sme-imports', '00000000-0000-4000-a000-00000000000a/other/file.csv') $$,
  '42501', null, 'no other path in the organization folder is writable');
select tests.act_as('b0000000-0000-4000-b000-000000000001');
select is((select count(*)::int from storage.objects where bucket_id = 'sme-imports' and name like '00000000-0000-4000-a000-00000000000a/%'), 0,
  'Org B cannot list Org A import files');
select throws_ok($$ select sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'b.csv', 'byte_size', 1, 'sha256', repeat('d', 64), 'mime_type', 'text/csv'), null, 'imp-b') $$,
  'P0001', 'ACCESS_DENIED', 'Org B cannot import into Org A');
select is((select count(*)::int from sme_import_batches where org_id = '00000000-0000-4000-a000-00000000000a'), 0, 'Org B sees no Org A batches');
select tests.act_as('a0000000-0000-4000-a000-000000000001');

-- ── Parse (worker simulated with the service role) ──────────
select is(sme_request_import_parse('00000000-0000-4000-a000-00000000000a', tests.id('b1'), '{"date":0,"description":1,"amount":2}', '{"date_format":"dd/mm/yyyy"}', null, 'imp-parse-1') ->> 'status',
  'parsing', 'a parse request moves the batch to parsing');
select throws_ok($$ select sme_import_store_rows('00000000-0000-4000-a000-00000000000a', tests.id('b1'), '[]', true) $$,
  '42501', null, 'only the worker stores parsed rows');
reset role;
select is((select count(*)::int from sme_outbox where event_type = 'ImportParseRequested' and payload ->> 'batchId' = tests.id('b1')::text), 1,
  'and the parse is queued for the worker');
set local role service_role;
select lives_ok($$ select sme_import_store_rows('00000000-0000-4000-a000-00000000000a', tests.id('b1'), jsonb_build_array(
  tests.row(2, '2026-10-01', '500000', 'Opening deposit', 'REF-1'),
  tests.row(3, '2026-10-02', '-12500', 'POS purchase supplies'),
  tests.row(4, '2026-10-03', '-40000', 'رواتب أكتوبر'),
  tests.row(5, '2026-10-04', '75500', 'CliQ transfer from customer'),
  tests.row(6, null, null, 'Closing balance'),
  tests.row(7, '2026-10-02', '-12500', 'POS  purchase SUPPLIES')), true) $$, 'the worker stores parsed rows');
set local role authenticated;
select results_eq($$ select status, count(*)::int from sme_import_rows where batch_id = tests.id('b1') group by status order by status $$,
  $$ values ('duplicate_in_file', 1), ('invalid', 1), ('valid', 4) $$, 'rows are valid, invalid or repeated within the file');

-- ── Review and an all-or-nothing commit ─────────────────────
select throws_ok($$ select sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'imp-commit-early') $$,
  'P0001', 'BATCH_NOT_REVIEWED', 'nothing commits while rows await a decision');
select lives_ok($$ select sme_review_import_rows('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'accept_valid', null, 'imp-rev-1') $$,
  'accepting valid rows excludes the duplicates by default');
create temp table cash_before as select coalesce(sum(amount_minor), 0) as total from sme_transactions where account_id = tests.id('acct');
grant select on cash_before to authenticated;

select set_config('sme.test_fail_import_after', '2', true);
select is(sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'imp-commit-1') -> 'error' ->> 'code', 'INTERNAL',
  'a failure part-way through the commit is reported');
select is((select count(*)::int from sme_transactions where import_batch_id = tests.id('b1')), 0, 'and leaves zero rows posted');
select results_eq($$ select status, error_code from sme_import_batches where id = tests.id('b1') $$, $$ values ('in_review', 'INTERNAL') $$,
  'with the batch still in review and the error recorded');
select set_config('sme.test_fail_import_after', '', true);

select is((sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'imp-commit-1') ->> 'posted')::int, 4,
  'the same request succeeds when retried');
select is((sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'imp-commit-1') ->> 'posted')::int, 4,
  'a replay returns the stored result');
select is((select count(*)::int from sme_transactions t join sme_import_rows r on r.id = t.import_row_id
           where t.import_batch_id = tests.id('b1') and t.source_kind = 'import' and r.posted_transaction_id = t.id), 4,
  'posted lines reference their batch and row, once each');
select throws_ok($$ select sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b1'), null, 'imp-commit-2') $$,
  'P0001', 'BATCH_ALREADY_COMMITTED', 'a second commit with another key is refused');
reset role;
select is((select count(*)::int from sme_outbox where event_type = 'ImportCommitted' and payload ->> 'batchId' = tests.id('b1')::text), 1,
  'one ImportCommitted event, so figures recompute once');
set local role authenticated;
select is((select coalesce(sum(amount_minor), 0) from sme_transactions where account_id = tests.id('acct')) - (select total from cash_before), 523000::numeric,
  'the account changes by the accepted rows only');

-- ── An overlapping second statement ─────────────────────────
insert into tests.ids select 'b2', (sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'November.csv', 'byte_size', 4096, 'sha256', repeat('b', 64), 'mime_type', 'text/csv'), null, 'imp-b2') ->> 'batch_id')::uuid;
select sme_request_import_parse('00000000-0000-4000-a000-00000000000a', tests.id('b2'), '{"date":0,"description":1,"amount":2}', '{}', null, 'imp-parse-2');
set local role service_role;
select sme_import_store_rows('00000000-0000-4000-a000-00000000000a', tests.id('b2'), jsonb_build_array(
  tests.row(2, '2026-10-03', '-40000', 'رواتب اكتوبر'),
  tests.row(3, '2026-10-04', '75500', 'CliQ transfer from customer'),
  tests.row(4, '2026-11-01', '20000', 'Refund', 'REF-1'),
  tests.row(5, '2026-11-02', '-9000', 'Bank fees')), true);
set local role authenticated;
select results_eq($$ select row_number, status from sme_import_rows where batch_id = tests.id('b2') order by row_number $$,
  $$ values (2, 'duplicate_suspected'), (3, 'duplicate_suspected'), (4, 'duplicate_existing'), (5, 'valid') $$,
  'rows already posted are suspected duplicates; a known bank reference is an existing duplicate');
select throws_ok($$ select sme_review_import_rows('00000000-0000-4000-a000-00000000000a', tests.id('b2'),
  jsonb_build_array(jsonb_build_object('row_id', (select id from sme_import_rows where batch_id = tests.id('b2') and row_number = 4), 'action', 'accept')), null, null, 'imp-rev-2') $$,
  'P0001', 'VALIDATION_FAILED', 'a duplicate is included only with a reason');
select lives_ok($$ select sme_review_import_rows('00000000-0000-4000-a000-00000000000a', tests.id('b2'),
  jsonb_build_array(jsonb_build_object('row_id', (select id from sme_import_rows where batch_id = tests.id('b2') and row_number = 4), 'action', 'accept',
                                       'override_reason', 'Separate refund with the same reference')), 'accept_valid', null, 'imp-rev-3') $$,
  'with a reason it is included');
truncate cash_before;
insert into cash_before select coalesce(sum(amount_minor), 0) from sme_transactions where account_id = tests.id('acct');
select is((sme_commit_import('00000000-0000-4000-a000-00000000000a', tests.id('b2'), null, 'imp-commit-3') ->> 'posted')::int, 2, 'only the new rows post');
select is((select coalesce(sum(amount_minor), 0) from sme_transactions where account_id = tests.id('acct')) - (select total from cash_before), 11000::numeric,
  'and the overlap does not change the balance');

-- ── A failed parse shows nothing and frees the file ─────────
insert into tests.ids select 'b3', (sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'broken.csv', 'byte_size', 10, 'sha256', repeat('e', 64), 'mime_type', 'text/csv'), null, 'imp-b3') ->> 'batch_id')::uuid;
select sme_request_import_parse('00000000-0000-4000-a000-00000000000a', tests.id('b3'), '{}', '{}', null, 'imp-parse-3');
set local role service_role;
select sme_import_fail('00000000-0000-4000-a000-00000000000a', tests.id('b3'), 'PARSE_FAILED', '{"reason":"no_rows"}');
set local role authenticated;
select results_eq($$ select status, error_code, (select count(*)::int from sme_import_rows where batch_id = tests.id('b3')) from sme_import_batches where id = tests.id('b3') $$,
  $$ values ('failed', 'PARSE_FAILED', 0) $$, 'a failed parse is failed with no rows');
select lives_ok($$ select sme_create_import_batch('00000000-0000-4000-a000-00000000000a', tests.id('acct'),
  jsonb_build_object('file_name', 'broken.csv', 'byte_size', 10, 'sha256', repeat('e', 64), 'mime_type', 'text/csv'), null, 'imp-b3-again') $$,
  'and the same file can be uploaded again');

select * from finish();
rollback;
