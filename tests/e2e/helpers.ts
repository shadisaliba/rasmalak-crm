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

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits), enough to complete enrolment in tests.
export async function totp(secret: string, at = Date.now()): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const bits = secret.replace(/=+$/, '').toUpperCase().split('').map(c => BASE32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
