import { test, expect } from "@playwright/test";

test.describe("signed-out smoke", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/ITSMART/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("protected route redirects to login", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("register route redirects to login (signup disabled)", async ({ page }) => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/login$/);
  });
});
