-- The product is the SME platform, with the CRM inside it (decision of 22 Nov 2026, docs/gates/decisions.md).
-- Every Jordanian organization gets the SME modules whatever its plan; the `sme_suite` plan feature is retired.
-- Plan tiers may limit individual features later, but they no longer switch the platform off.
create or replace function sme_enabled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organizations o
    where o.id = p_org
      and o.country = 'JO'
  );
$$;
