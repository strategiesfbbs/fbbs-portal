import { expect, test } from '@playwright/test';

test.describe('Reports Phase 1', () => {
  test('opens the new reports landing and type picker', async ({ page }) => {
    await page.goto('/#reports');
    await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible();
    await expect(page.getByText('Peer averages:')).toBeVisible();

    await page.getByRole('link', { name: 'New Report' }).click();
    await expect(page.getByRole('heading', { name: 'Create Report' })).toBeVisible();
    await page.getByRole('button', { name: /Bank Peer Analysis/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/#reports\/build\/bank-peer/);
    await expect(page.getByRole('heading', { name: 'Bank Peer Analysis' })).toBeVisible();
  });

  test('opens data sources and the full files route', async ({ page }) => {
    await page.goto('/#reports/data');
    await expect(page.getByRole('heading', { name: 'Data Sources' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Averaged-Series Import' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bond Accounting Import' })).toBeVisible();

    await page.goto('/#reports/data/files');
    await expect(page.getByRole('heading', { name: 'Matched Portfolio Files' })).toBeVisible();
    await expect(page.getByText(/Showing .* portfolio files/)).toBeVisible();
  });

  test('keeps the legacy reports workspace available', async ({ page }) => {
    await page.goto('/#reports?legacy=1');
    await expect(page.getByRole('heading', { name: 'Report Builder' })).toBeVisible();
    await expect(page.getByText('Select a report type to stage the inputs.')).toBeVisible();
  });
});
