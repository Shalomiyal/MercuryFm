import { expect, test } from '@playwright/test'

test('login page renders with a document title and favicon', async ({ page }) => {
  await page.goto('/login')
  await expect(page).toHaveTitle(/Sign in · Mercury FM/)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

test('signup page renders its invite code field', async ({ page }) => {
  await page.goto('/signup')
  await expect(page).toHaveTitle(/Create account · Mercury FM/)
  await expect(page.locator('#signup-invite')).toBeVisible()
})

test('unknown routes render the 404 page', async ({ page }) => {
  await page.goto('/this-page-does-not-exist')
  await expect(page).toHaveTitle(/Page not found · Mercury FM/)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})
