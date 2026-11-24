/**
 * CRM smoke tests for a signed-in member of an organization (saved session from auth.setup.ts).
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, totp } from './helpers';

test.beforeEach(forceEnglish);

test('contacts list loads', async ({ page }) => {
  await page.goto('/crm/contacts');
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible({ timeout: 15_000 });
});

test('settings lists security and preferences', async ({ page }) => {
  await page.goto('/crm/settings');
  await expect(page.getByRole('button', { name: /security/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /preferences/i })).toBeVisible();
});

test('security settings show password change and two-factor setup', async ({ page }) => {
  await page.goto('/crm/settings/security');
  await expect(page.getByRole('heading', { name: 'Change Password' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();
  await expect(page.getByRole('button', { name: /set up 2fa|disable 2fa/i })).toBeVisible();
});

test('two-factor enrolment shows a QR code and secret, and can be cancelled', async ({ page }) => {
  await page.goto('/crm/settings/security');
  await expect(page.getByRole('button', { name: /set up 2fa|disable 2fa/i })).toBeVisible({ timeout: 15_000 });
  const setup = page.getByRole('button', { name: /set up 2fa/i });
  test.skip(!(await setup.isVisible()), 'Test user already has 2FA enabled');
  await setup.click();
  await expect(page.getByRole('img', { name: /scan qr code/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('code')).toHaveText(/^[A-Z2-7]{16,}$/);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(setup).toBeVisible();
});

test('two-factor can be enrolled, verified and removed', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/crm/settings/security');
  await page.getByRole('button', { name: /set up 2fa/i }).click();
  const secret = (await page.locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  await page.getByLabel('Verification Code').fill(await totp(secret));
  await page.getByRole('button', { name: /verify & enable/i }).click();
  await expect(page.getByText('Two-factor authentication enabled successfully')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /disable 2fa/i })).toBeVisible();

  // Use a code from the next 30-second window so removal never replays the enrolment code.
  const nextWindow = Math.ceil(Date.now() / 30_000) * 30_000;
  await page.waitForTimeout(nextWindow - Date.now() + 500);
  await page.getByRole('button', { name: /disable 2fa/i }).click();
  await page.getByLabel('Verification Code').fill(await totp(secret));
  await page.getByRole('button', { name: /disable 2fa/i }).click();
  await expect(page.getByText('Two-factor authentication turned off')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /set up 2fa/i })).toBeVisible();
});

test('preferences switch the interface language and direction', async ({ page }) => {
  await page.goto('/crm/settings/preferences');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
