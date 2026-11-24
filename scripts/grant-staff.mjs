#!/usr/bin/env node
// Grants or revokes platform staff roles (W3b-01). Staff are managed only here in the MVP, with the
// service role, and every change is written to sme_audit_events at platform level.
//
//   node scripts/grant-staff.mjs <email> content_editor,subject_reviewer [--env .env.local]
//   node scripts/grant-staff.mjs <email> --revoke [--env .env.local]
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROLES = ['content_editor', 'subject_reviewer', 'legal_reviewer', 'rules_admin', 'directory_curator', 'compliance_lead'];

const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
config({ path: envIndex >= 0 ? args[envIndex + 1] : '.env.local', quiet: true });
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--env');
const revoke = args.includes('--revoke');
const [email, rolesArg] = positional;

if (!email || (!revoke && !rolesArg)) {
  console.error('Usage: node scripts/grant-staff.mjs <email> <role,role> | --revoke [--env <file>]');
  console.error(`Roles: ${ROLES.join(', ')}`);
  process.exit(1);
}
const roles = revoke ? [] : rolesArg.split(',').map(r => r.trim()).filter(Boolean);
const unknown = roles.filter(r => !ROLES.includes(r));
if (unknown.length) { console.error(`Unknown role(s): ${unknown.join(', ')}`); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

async function findUser(address) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find(u => u.email?.toLowerCase() === address.toLowerCase());
    if (user) return user;
    if (data.users.length < 200) return null;
  }
}

const user = await findUser(email);
if (!user) { console.error(`No user with email ${email}. They must sign up first.`); process.exit(1); }

if (revoke) {
  const { error } = await db.from('platform_staff').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id);
  if (error) throw error;
} else {
  const { error } = await db.from('platform_staff')
    .upsert({ user_id: user.id, roles, granted_at: new Date().toISOString(), revoked_at: null }, { onConflict: 'user_id' });
  if (error) throw error;
}
const { error: auditError } = await db.from('sme_audit_events').insert({
  org_id: null, actor_id: null, action: revoke ? 'staff.revoked' : 'staff.granted', subject_type: 'platform_staff',
  subject_id: user.id, payload: { roles, via: 'scripts/grant-staff.mjs' }, correlation_id: randomUUID(),
});
if (auditError) throw auditError;
console.log(revoke ? `Revoked staff access for ${email}.` : `${email} now has: ${roles.join(', ')}.`);
