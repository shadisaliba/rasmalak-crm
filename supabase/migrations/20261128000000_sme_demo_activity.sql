-- ============================================================
-- SAMPLE BUSINESS ACTIVITY: customers, suppliers, invoices, bills and planned payments
-- ============================================================
-- The W2-07 sample business has thirteen weeks of transactions but no registers, so the forecast,
-- "Needs your attention" and the reports had little to show. This adds a customer who pays about
-- two weeks late (three paid invoices), two overdue invoices, one coming up, two large supplier
-- bills close together, rent and payroll as planned payments, and a cash buffer. Contacts get no
-- phone numbers: a public demo must never be able to message a real person.

create or replace function sme_seed_demo_activity(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid;
  v_bank uuid;
  v_alnoor uuid;
  v_zaid uuid;
  v_petra uuid;
  v_packaging uuid;
  v_equipment uuid;
  v_invoice uuid;
  v_bill uuid;
  v_tx sme_transactions;
  v_paid record;
  v_doc record;
  v_n int := 0;
begin
  select created_by into v_owner from organizations where id = p_org and is_demo;
  if v_owner is null then
    perform sme_fail('VALIDATION_FAILED', '{"reason":"not_a_demo_organization"}');
  end if;
  if exists (select 1 from sme_audit_events where org_id = p_org and action = 'demo.activity_seeded') then
    return jsonb_build_object('seeded', false);
  end if;
  -- Run from the SQL console, act as the sample business's owner: ledger rows record who posted them.
  if auth.uid() is null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  end if;

  select id into v_bank from sme_accounts where org_id = p_org and kind = 'bank' order by created_at limit 1;

  insert into crm_companies (org_id, name, name_ar, created_by) values (p_org, 'Al-Noor Trading (sample)', 'النور للتجارة (نموذجي)', v_owner) returning id into v_alnoor;
  insert into crm_companies (org_id, name, name_ar, created_by) values (p_org, 'Zaid Bakery (sample)', 'مخبز زيد (نموذجي)', v_owner) returning id into v_zaid;
  insert into crm_companies (org_id, name, name_ar, created_by) values (p_org, 'Petra Hotel (sample)', 'فندق البترا (نموذجي)', v_owner) returning id into v_petra;
  insert into crm_companies (org_id, name, name_ar, created_by) values (p_org, 'Amman Packaging (sample)', 'عمّان للتغليف (نموذجي)', v_owner) returning id into v_packaging;
  insert into crm_companies (org_id, name, name_ar, created_by) values (p_org, 'Al-Rawabi Equipment (sample)', 'الروابي للمعدات (نموذجي)', v_owner) returning id into v_equipment;
  insert into crm_contacts (org_id, company_id, first_name, first_name_ar, created_by) values
    (p_org, v_alnoor, 'Huda', 'هدى', v_owner), (p_org, v_zaid, 'Omar', 'عمر', v_owner), (p_org, v_petra, 'Lina', 'لينا', v_owner);

  -- Invoices: [customer, number, issue (days from today), due, amount, description, paid (days after due) or null]
  for v_doc in
    select * from (values
      (v_petra,  'INV-SAMPLE-001', -95, -65, 1450000::bigint, 'Catering contract', 12),
      (v_petra,  'INV-SAMPLE-002', -65, -35, 1620000::bigint, 'Catering contract', 15),
      (v_petra,  'INV-SAMPLE-003', -40, -10, 1380000::bigint, 'Catering contract', 8),
      (v_alnoor, 'INV-SAMPLE-004', -70, -40, 3200000::bigint, 'Event catering', null),
      (v_zaid,   'INV-SAMPLE-005', -42, -12, 1200000::bigint, 'Pastry supply', null),
      (v_petra,  'INV-SAMPLE-006',  -5,  25, 4500000::bigint, 'Catering contract', null)
    ) as t(customer, number, issue, due, amount, descr, late)
  loop
    v_n := v_n + 1;
    insert into sme_invoices (org_id, number, customer_company_id, issue_date, due_date, currency, subtotal_minor, total_minor, status, idempotency_key, created_by)
    values (p_org, v_doc.number, v_doc.customer, current_date + v_doc.issue, current_date + v_doc.due, 'JOD', v_doc.amount, v_doc.amount, 'draft', 'demo:inv:' || v_n, v_owner)
    returning id into v_invoice;
    insert into sme_invoice_lines (org_id, invoice_id, position, description, quantity, unit_price_minor, tax_rate_bp, line_subtotal_minor, line_tax_minor)
    values (p_org, v_invoice, 1, v_doc.descr, 1, v_doc.amount, 0, v_doc.amount, 0);
    update sme_invoices set status = 'open', status_changed_by = v_owner, status_changed_at = now() where id = v_invoice;
    if v_doc.late is not null and v_bank is not null then
      v_tx := sme_ledger_insert(p_org, v_bank, least(current_date + v_doc.due + v_doc.late, current_date - 1), v_doc.amount, null,
                                'Transfer from Petra Hotel', null, 'manual', null, false, null, 'demo:receipt:' || v_n);
      perform sme_ledger_classify(p_org, v_tx, 'manual', jsonb_build_object('category_id', sme_system_category('sales'), 'channel', 'bank_transfer', 'counterparty_company_id', v_petra));
      insert into sme_invoice_allocations (org_id, invoice_id, transaction_id, amount_minor, idempotency_key, created_by)
      values (p_org, v_invoice, v_tx.id, v_doc.amount, 'demo:alloc:' || v_n, v_owner);
    end if;
  end loop;

  -- Bills: two large ones a week apart, so the forecast shows a shortfall to work through.
  for v_doc in
    select * from (values
      (v_packaging, 'AP-311',  -20,  5,  6800000::bigint, 'Packaging stock'),
      (v_equipment, 'RW-2207', -10, 12, 18500000::bigint, 'Oven and display fridge')
    ) as t(supplier, reference, issue, due, amount, descr)
  loop
    v_n := v_n + 1;
    insert into sme_bills (org_id, supplier_company_id, supplier_reference, issue_date, due_date, currency, subtotal_minor, total_minor, status, idempotency_key, created_by)
    values (p_org, v_doc.supplier, v_doc.reference, current_date + v_doc.issue, current_date + v_doc.due, 'JOD', v_doc.amount, v_doc.amount, 'draft', 'demo:bill:' || v_n, v_owner)
    returning id into v_bill;
    insert into sme_bill_lines (org_id, bill_id, position, description, quantity, unit_price_minor, tax_rate_bp, line_subtotal_minor, line_tax_minor)
    values (p_org, v_bill, 1, v_doc.descr, 1, v_doc.amount, 0, v_doc.amount, 0);
    update sme_bills set status = 'open', status_changed_by = v_owner, status_changed_at = now() where id = v_bill;
  end loop;

  insert into sme_scheduled_items (org_id, label, direction, amount_minor, start_date, recurrence, category_id, created_by) values
    (p_org, 'Shop rent', 'out', 650000, (date_trunc('month', current_date) + interval '1 month')::date, 'monthly', sme_system_category('rent'), v_owner),
    (p_org, 'Salaries', 'out', 1800000, (date_trunc('month', current_date) + interval '27 days')::date, 'monthly', sme_system_category('salaries_wages'), v_owner);
  insert into sme_forecast_settings (org_id, buffer_minor, updated_by) values (p_org, 2000000, v_owner)
  on conflict (org_id) do nothing;

  -- The forecast, actions and summary pick this up from the outbox.
  perform sme_emit(p_org, 'ScheduledItemChanged', jsonb_build_object('itemId', null), 'demo:activity:' || p_org);
  perform sme_audit(p_org, 'demo.activity_seeded', 'organization', p_org, null, null, jsonb_build_object('documents', v_n), null);
  return jsonb_build_object('seeded', true, 'documents', v_n);
end;
$$;

revoke all on function sme_seed_demo_activity(uuid) from public, anon, authenticated;

-- New sample businesses get the activity too.
create or replace function sme_create_demo_org()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_org uuid;
begin
  if auth.uid() is null then perform sme_fail('UNAUTHENTICATED'); end if;
  select o.id into v_existing
  from organizations o
  join org_members m on m.org_id = o.id and m.user_id = auth.uid() and m.is_active and m.revoked_at is null
  where o.is_demo and o.created_by = auth.uid()
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('org_id', v_existing, 'created', false);
  end if;

  perform set_config('sme.creating_demo', 'on', true);
  insert into organizations (name, name_ar, country, currency, is_demo, created_by)
  values ('Sample business', 'منشأة تجريبية', 'JO', 'JOD', true, auth.uid())
  returning id into v_org;
  perform set_config('sme.creating_demo', '', true);

  perform sme_seed_demo(v_org);
  perform sme_seed_demo_activity(v_org);
  perform sme_audit(v_org, 'demo.created', 'organization', v_org, null, null, '{}'::jsonb, null);
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;
