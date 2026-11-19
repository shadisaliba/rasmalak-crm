-- W2-01: idempotency, append-only audit events, and the outbox.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- ── Audit events are append-only for every role ──────────────
select sme_audit('00000000-0000-4000-a000-00000000000a', 'test.created', 'thing', null, null, '{"a":1}', '{}', gen_random_uuid());
select is((select count(*)::int from sme_audit_events where action = 'test.created'), 1, 'sme_audit writes an event');
select isnt((select after_hash from sme_audit_events where action = 'test.created'), null, 'the after state is hashed');
select throws_ok($$ update sme_audit_events set action = 'x' where action = 'test.created' $$, 'P0001', 'LEDGER_IMMUTABLE', 'even the owner role cannot update audit events');
select throws_ok($$ delete from sme_audit_events where action = 'test.created' $$, 'P0001', 'LEDGER_IMMUTABLE', 'even the owner role cannot delete audit events');
select throws_ok($$ truncate sme_audit_events $$, 'P0001', 'LEDGER_IMMUTABLE', 'audit events cannot be truncated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select sme_audit('00000000-0000-4000-a000-00000000000a', 'forged', 'thing', null, null, null, '{}', gen_random_uuid()) $$,
  '42501', null, 'members cannot call sme_audit directly');
select throws_ok($$ insert into sme_audit_events (org_id, action, subject_type, correlation_id) values ('00000000-0000-4000-a000-00000000000a', 'forged', 'x', gen_random_uuid()) $$,
  '42501', null, 'members cannot insert audit events');
select throws_ok($$ select sme_emit('00000000-0000-4000-a000-00000000000a', 'Forged', '{}', 'x') $$, '42501', null, 'members cannot emit events');
select throws_ok($$ select * from sme_outbox_claim() $$, '42501', null, 'members cannot claim outbox events');
reset role;

-- ── Idempotency: a stand-in for a mutating RPC ──────────────
create table pg_temp.side_effects (n int);
create function pg_temp.fake_rpc(p_key text, p_input jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  v := sme_idem_begin('00000000-0000-4000-a000-00000000000a', p_key, 'test.op', p_input);
  if v is not null then return v; end if;
  insert into pg_temp.side_effects values (1);
  return sme_idem_finish('00000000-0000-4000-a000-00000000000a', p_key, 'test.op', p_input,
    jsonb_build_object('created', (select count(*) from pg_temp.side_effects)));
end $$;

select is(pg_temp.fake_rpc('key-1', '{"amount":5,"b":2}'), '{"created":1}'::jsonb, 'first call runs');
select is(pg_temp.fake_rpc('key-1', '{"b":2,"amount":5}'), '{"created":1}'::jsonb, 'a replay with the same body returns the stored response');
select is((select count(*)::int from pg_temp.side_effects), 1, 'the replay had no side effect');
select throws_ok($$ select pg_temp.fake_rpc('key-1', '{"amount":6}') $$, 'P0001', 'IDEMPOTENCY_CONFLICT', 'reusing a key with a different body is a conflict');

-- ── Outbox ──────────────────────────────────────────────────
select sme_emit('00000000-0000-4000-a000-00000000000a', 'TestEvent', '{"n":1}', 'dedupe-1');
select sme_emit('00000000-0000-4000-a000-00000000000a', 'TestEvent', '{"n":2}', 'dedupe-1');
select is((select count(*)::int from sme_outbox where dedupe_key = 'dedupe-1'), 1, 'a duplicate event is ignored');

select is((select count(*)::int from sme_outbox_claim(100) where dedupe_key = 'dedupe-1'), 1, 'the worker claims the event');
select is((select count(*)::int from sme_outbox_claim(100) where dedupe_key = 'dedupe-1'), 0, 'an overlapping claim skips the leased event');

select sme_outbox_fail((select id from sme_outbox where dedupe_key = 'dedupe-1'), 'boom');
select ok((select available_at > now() + interval '1 minute' and last_error = 'boom' from sme_outbox where dedupe_key = 'dedupe-1'),
  'a failure backs off and records the error');

select * from finish();
rollback;
