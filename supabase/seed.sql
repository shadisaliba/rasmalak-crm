-- Local development seed only. Production data never comes from this file.
-- Every user's password is: Passw0rd!local

-- Fixed ids so tests and fixtures can refer to them.
--   Org A  00000000-0000-4000-a000-00000000000a   owner  a0000000-0000-4000-a000-000000000001  owner.a@example.test
--   Org B  00000000-0000-4000-b000-00000000000b   owner  b0000000-0000-4000-b000-000000000001  owner.b@example.test
--   No org                                       user   c0000000-0000-4000-c000-000000000001  no.org@example.test
--   Invitee for the e2e invitation test          user   e0000000-0000-4000-e000-000000000001  join.me@example.test

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Passw0rd!local', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('name', u.name), now(), now(),
  '', '', '', ''
from (values
  ('a0000000-0000-4000-a000-000000000001'::uuid, 'owner.a@example.test', 'Owner A'),
  ('b0000000-0000-4000-b000-000000000001'::uuid, 'owner.b@example.test', 'Owner B'),
  ('c0000000-0000-4000-c000-000000000001'::uuid, 'no.org@example.test', 'No Org'),
  ('e0000000-0000-4000-e000-000000000001'::uuid, 'join.me@example.test', 'Join Me')
) as u(id, email, name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@example.test';

-- The organization triggers add the creator as owner and create default roles and a pipeline.
insert into organizations (id, name, name_ar, country, currency, created_by) values
  ('00000000-0000-4000-a000-00000000000a', 'Org A Trading', 'شركة أ للتجارة', 'JO', 'JOD', 'a0000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-b000-00000000000b', 'Org B Services', 'شركة ب للخدمات', 'JO', 'JOD', 'b0000000-0000-4000-b000-000000000001');

insert into crm_contacts (org_id, first_name, last_name, email, created_by) values
  ('00000000-0000-4000-a000-00000000000a', 'Lina', 'Haddad', 'lina@org-a.example.test', 'a0000000-0000-4000-a000-000000000001'),
  ('00000000-0000-4000-b000-00000000000b', 'Omar', 'Khalil', 'omar@org-b.example.test', 'b0000000-0000-4000-b000-000000000001');
