import type { Page } from '@playwright/test';

// Selectors below use English copy, so tests that are not about locale force English.
export async function forceEnglish({ page }: { page: Page }) {
  await page.addInitScript(() => {
    localStorage.setItem('rasmalak-storage', JSON.stringify({ state: { language: 'en', theme: 'light' } }));
  });
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('name@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /log in/i }).click();
}
