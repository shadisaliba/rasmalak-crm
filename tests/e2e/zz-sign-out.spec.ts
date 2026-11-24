/**
 * Signing out ends every session of the user (Supabase's default global scope), including the one
 * the other tests share, so this file is named to run last.
 */
import { test } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

test('sign out returns to the login page', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await forceEnglish({ page });
  await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  await context.close();
});
