#!/usr/bin/env node
// Imports the consumer app's SME courses as DRAFT lessons (W3b-02, playbook Appendix B.4). Nothing
// is published: reviewers approve each language in Content review. Tax and legal lessons are
// marked regulated, so they also need a legal reviewer, a legal source and a start date.
//
//   node scripts/import-consumer-courses.mjs --author <staff editor email> [--ref 720f174] [--dry-run] [--env .env.local]
//
// The JSON is read from git (the consumer repository's main, fetched as a remote), so it is never
// committed under src/.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
config({ path: opt('--env') ?? '.env.local', quiet: true });
const ref = opt('--ref') ?? '720f174';
const author = opt('--author');
const dryRun = args.includes('--dry-run');
if (!author && !dryRun) { console.error('Usage: node scripts/import-consumer-courses.mjs --author <email> [--ref 720f174] [--dry-run]'); process.exit(1); }

const SUBJECTS = ['sme_financial_management', 'taxes_and_legal'];
const LEVELS = [['', 'beginner'], ['_intermediate', 'intermediate'], ['_advanced', 'advanced']];
// Near-duplicate lessons in the advanced SME course (playbook W3b-02 step 4), by English title.
const POSSIBLE_DUPLICATES = [
  'Exit Strategy: EBITDA Multiples and M&A', 'Exit Strategy: EBITDA Multiples and M&A Dynamics',
  'Sophisticated Treasury Management and Hedging', 'Sophisticated Treasury Management and Price Hedging',
  'Equity Incentive Plans and Talent Retention', 'Equity Incentive Plans and Talent Retention at Scale',
];

function donor(file) {
  return JSON.parse(execFileSync('git', ['show', `${ref}:src/data/courses/${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

// A few donor translations have an empty paragraph; it is dropped and the version note says so.
function cleanBody(lesson) {
  let removed = 0;
  const sections = lesson.sections.map(s => ({
    ...s,
    blocks: s.blocks.filter(b => {
      const empty = (b.type === 'p' || b.type === 'action_prompt') && !String(b.text ?? '').trim();
      if (empty) removed++;
      return !empty;
    }),
  }));
  return { body: { sections }, removed };
}

function summaryOf(lesson) {
  const first = lesson.sections.flatMap(s => s.blocks).find(b => b.type === 'p');
  const text = (first?.text ?? lesson.title).replace(/\s+/g, ' ').trim();
  if (text.length <= 280) return text;
  return `${text.slice(0, 280).replace(/\s+\S*$/, '')}…`;
}

const items = [];
for (const subject of SUBJECTS) {
  for (const [suffix, level] of LEVELS) {
    const en = donor(`${subject}${suffix}_en.json`);
    const ar = donor(`${subject}${suffix}_ar.json`);
    const arByKey = new Map(ar.lessons.map(l => [l.lessonId.replace(/_(en|ar)$/, ''), l]));
    for (const lessonEn of en.lessons) {
      const key = lessonEn.lessonId.replace(/_(en|ar)$/, '');
      const lessonAr = arByKey.get(key);
      const slug = `${subject}_${level}_${key}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const note = POSSIBLE_DUPLICATES.includes(lessonEn.title) ? 'possible duplicate' : `Imported from consumer main @${ref}`;
      items.push({
        slug, regulated: subject === 'taxes_and_legal', level, topic_tags: [subject],
        versions: [['en', lessonEn], ['ar', lessonAr]].filter(([, l]) => l).map(([locale, l]) => {
          const { body, removed } = cleanBody(l);
          return {
            locale, title: l.title.slice(0, 200), summary: summaryOf(l), body,
            change_note: removed ? `${note}; ${removed} empty block(s) removed, compare with the other language` : note,
          };
        }),
      });
    }
  }
}
console.log(`${items.length} lessons, ${items.reduce((n, i) => n + i.versions.length, 0)} language versions, ${items.filter(i => i.regulated).length} regulated.`);
if (dryRun) { console.log('Dry run: nothing written.'); process.exit(0); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

let authorId = null;
for (let page = 1; !authorId; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  authorId = data.users.find(u => u.email?.toLowerCase() === author.toLowerCase())?.id ?? null;
  if (data.users.length < 200) break;
}
if (!authorId) { console.error(`No user with email ${author}.`); process.exit(1); }
const { data: staff } = await db.from('platform_staff').select('roles').eq('user_id', authorId).is('revoked_at', null).maybeSingle();
if (!staff?.roles?.includes('content_editor')) { console.error(`${author} is not a content editor. Run scripts/grant-staff.mjs first.`); process.exit(1); }

let created = 0;
let skipped = 0;
for (const item of items) {
  const { data: existing } = await db.from('content_items').select('id').eq('slug', item.slug).maybeSingle();
  if (existing) { skipped++; continue; }
  const { data: row, error } = await db.from('content_items').insert({
    slug: item.slug, kind: 'lesson', regulated: item.regulated, level: item.level, topic_tags: item.topic_tags, created_by: authorId,
  }).select('id').single();
  if (error) throw error;
  const { error: vError } = await db.from('content_versions').insert(item.versions.map(v => ({
    item_id: row.id, version: 1, locale: v.locale, title: v.title, summary: v.summary, body: v.body,
    state: 'draft', author_id: authorId, change_note: v.change_note,
  })));
  if (vError) throw vError;
  created++;
}
const { error: auditError } = await db.from('sme_audit_events').insert({
  org_id: null, actor_id: authorId, action: 'content.imported', subject_type: 'content_import',
  payload: { ref, created, skipped, via: 'scripts/import-consumer-courses.mjs' }, correlation_id: randomUUID(),
});
if (auditError) throw auditError;
console.log(`Imported ${created} lessons as drafts; ${skipped} already existed.`);
