/**
 * Auth flow tests (unauthenticated — no stored session used here).
 * Tests: default locale, login page UI, forgot password, signup form validation, redirect guard.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish, signIn } from './helpers';

// These tests run without the saved session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Default locale', () => {
  test('a fresh browser loads in Arabic, right to left', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test.describe('Login page', () => {
  test.beforeEach(forceEnglish);

  test('renders login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder('name@example.com')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('name@example.com').fill('bad@example.com');
    await page.getByPlaceholder('Enter your password').fill('wrongpassword');
    await page.getByRole('button', { name: /log in/i }).click();
    // Error message should appear
    await expect(page.locator('text=/invalid|incorrect|wrong|error/i')).toBeVisible({ timeout: 8000 });
  });

  test('password visibility toggle works', async ({ page }) => {
    await page.goto('/login');
    const passwordInput = page.getByPlaceholder('Enter your password');
    await expect(passwordInput).toHaveAttribute('type', 'password');
    // Click the eye icon toggle
    await page.locator('button[aria-label*="password"], button:near(input[type="password"])').first().click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
  });

  test('a member of an organization lands on the CRM dashboard', async ({ page }) => {
    await signIn(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
    await page.waitForURL(/\/crm\/dashboard/, { timeout: 15_000 });
  });

  test('a user without an organization lands on organization setup', async ({ page }) => {
    const email = process.env.TEST_NO_ORG_EMAIL;
    const password = process.env.TEST_NO_ORG_PASSWORD;
    test.skip(!email || !password, 'Set TEST_NO_ORG_EMAIL and TEST_NO_ORG_PASSWORD to a user with no organization');
    await signIn(page, email!, password!);
    await page.waitForURL(/\/crm\/setup/, { timeout: 15_000 });
  });
});

test.describe('Signup page', () => {
  test.beforeEach(forceEnglish);

  test('renders signup form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /get started/i })).toBeVisible();
    await expect(page.getByPlaceholder(/amir al-masri/i)).toBeVisible();
    await expect(page.getByPlaceholder('name@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /create my account/i })).toBeVisible();
  });

  test('shows validation error for short password', async ({ page }) => {
    await page.goto('/signup');
    await page.getByPlaceholder(/amir al-masri/i).fill('Test User');
    await page.getByPlaceholder('name@example.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').fill('abc');
    await page.getByRole('button', { name: /create my account/i }).click();
    await expect(page.locator('text=/password|كلمة المرور/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('has link back to login', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: /login/i })).toBeVisible();
  });
});

test.describe('Forgot password page', () => {
  test.beforeEach(forceEnglish);

  test('renders form', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /back to login/i })).toBeVisible();
  });

  test('shows success state after submitting email', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('textbox').fill('any@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();
    // Should show success message (same regardless of whether email exists)
    await expect(page.locator('text=/check your email|تحقق من بريدك/i')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Auth guard', () => {
  test.beforeEach(forceEnglish);

  // In development AuthGuard bypasses its check; OrgGuard still sends signed-out users to /login.
  for (const path of ['/', '/crm/dashboard', '/crm/contacts', '/crm/settings/security']) {
    test(`redirects signed-out users from ${path} to login`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/login/, { timeout: 15_000 });
    });
  }
});
