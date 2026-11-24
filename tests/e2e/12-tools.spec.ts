/**
 * W3a-05/W3a-06, pilot scenario CAL-S01: a consultant prices a service. Zero billable hours are
 * blocked, tax is explained separately, and a saved scenario keeps its version.
 */
import { test, expect } from '@playwright/test';
import { forceEnglish } from './helpers';

test.beforeEach(forceEnglish);

test('CAL-S01: price a service', async ({ page }) => {
  await page.goto('/crm/tools');
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: /Service hourly rate/ }).click();

  await page.getByLabel('Pay you want for yourself in a year').fill('24,000');
  await page.getByLabel('Yearly running costs').fill('6000');
  await page.getByLabel('Profit you want the business to keep in a year').fill('0');
  await page.getByLabel('Working weeks in a year').fill('46');
  await page.getByLabel('Working hours in a week').fill('0');
  await page.getByLabel('Share of hours you can bill').fill('60');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(page.getByText('Billable hours can’t be zero.')).toBeVisible();

  await page.getByLabel('Working hours in a week').fill('40');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  // 30,000 JOD over 46 × 40 × 60 % = 1,104 hours.
  await expect(page.getByText(/27\.174/).first()).toBeVisible();
  await expect(page.getByText('These rates exclude sales tax.', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: /90\s*%/ })).toBeVisible();

  const name = `CAL-S01 ${Date.now()}`;
  await page.getByLabel('Scenario name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.goto('/crm/tools/saved');
  await expect(page.getByText(name)).toBeVisible();
});

test('regulated tools fail closed without a reviewed rate', async ({ page }) => {
  await page.goto('/crm/tools/employee_cost');
  await expect(page.getByText('The Jordanian rates this tool needs have not been reviewed yet', { exact: false })).toBeVisible({ timeout: 15_000 });
});
