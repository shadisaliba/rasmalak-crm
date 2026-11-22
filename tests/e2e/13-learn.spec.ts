/**
 * W3b-01/W3b-02, LRN-01 and LRN-02: a published lesson is found by search, its quiz can be
 * skipped, it is completed without the quiz, and progress is kept on return.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

const REST = `${process.env.SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' };
const SLUG = 'test-e2e-collections';
const OWNER_A = 'a0000000-0000-4000-a000-000000000001';

async function cleanup() {
  if (!KEY) return;
  const items = await (await fetch(`${REST}/content_items?slug=eq.${SLUG}&select=id`, { headers })).json() as { id: string }[];
  for (const { id } of items) {
    await fetch(`${REST}/lesson_feedback?item_id=eq.${id}`, { method: 'DELETE', headers });
    await fetch(`${REST}/lesson_progress?item_id=eq.${id}`, { method: 'DELETE', headers });
    await fetch(`${REST}/content_versions?item_id=eq.${id}`, { method: 'DELETE', headers });
    await fetch(`${REST}/content_items?id=eq.${id}`, { method: 'DELETE', headers });
  }
}

test.beforeEach(forceEnglish);
test.beforeAll(async () => {
  if (!KEY) return;
  await cleanup();
  // TEST_ fixture content, published directly: never seeded anywhere but the test database.
  const [item] = await (await fetch(`${REST}/content_items`, { method: 'POST', headers, body: JSON.stringify({
    slug: SLUG, kind: 'lesson', level: 'beginner', topic_tags: ['cash'], created_by: OWNER_A,
  }) })).json();
  await fetch(`${REST}/content_versions`, { method: 'POST', headers, body: JSON.stringify({
    item_id: item.id, version: 1, locale: 'en', state: 'published', published_at: new Date().toISOString(), author_id: OWNER_A,
    title: 'TEST_ Collecting from late customers', summary: 'TEST_ How to follow up on overdue invoices.', est_minutes: 5,
    body: { sections: [{ id: 's1', title: 'Follow up early', blocks: [
      { type: 'p', text: 'Call before the due date.' },
      { type: 'action_prompt', text: 'List every invoice more than 30 days overdue.' },
      { type: 'checkpoint', quiz: [{ question: 'When should you first follow up?', options: [{ text: 'Before the due date', correct: true }, { text: 'After 90 days' }], explanation: 'Early reminders work best.' }] },
    ] }] },
  }) });
});
test.afterAll(cleanup);

test('find a lesson, skip its quiz, complete it and come back', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  await page.goto('/crm/learn');
  await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Search lessons').fill('overdue');
  await page.getByRole('link', { name: /TEST_ Collecting from late customers/ }).click();

  await expect(page.getByText('Educational content, not professional advice.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Skip the quiz' }).click();
  await expect(page.getByText('Quiz skipped.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download the checklist (PDF)' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as complete' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Completed' })).toBeVisible();

  await page.goto('/crm/learn');
  await expect(page.getByRole('link', { name: /TEST_ Collecting from late customers/ })).toContainText('Completed');
  await page.goto(`/crm/learn/${SLUG}`);
  await expect(page.getByRole('status').filter({ hasText: 'Completed' })).toBeVisible();
});

test('a lesson missing in the reader’s language is reported, not translated', async ({ page }) => {
  test.skip(!KEY, 'Needs the local seed and service key');
  await page.addInitScript(() => {
    localStorage.setItem('rasmalak-storage', JSON.stringify({ state: { language: 'ar', theme: 'light' } }));
  });
  await page.goto(`/crm/learn/${SLUG}`);
  await expect(page.getByText('هذا الدرس غير متاح بالعربية بعد.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'اقرأه بالإنجليزية' }).click();
  await expect(page.getByText('TEST_ Collecting from late customers').first()).toBeVisible();
});
