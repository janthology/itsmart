import { test, expect } from "@playwright/test";

test.describe("signed-out smoke", () => {
  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/ITSMART/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("login Reports animation keeps valid SVG coordinates", async ({ page }) => {
    const svgErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /<circle> attribute (?:cx|cy): Expected length/i.test(message.text())) {
        svgErrors.push(message.text());
      }
    });
    await page.goto("/login");
    const tip = page.getByTestId("reports-preview-tip");
    await expect(tip).toHaveAttribute("cy", "9");
    // Cover at least one full animation cycle, including a module highlight change.
    await page.waitForTimeout(6000);
    await expect(tip).toHaveAttribute("cy", "9");
    expect(svgErrors).toEqual([]);
  });

  test("manifest is served as JSON rather than a redirect", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/(?:application\/manifest\+json|application\/json)/);
    expect(await response.json()).toMatchObject({ short_name: "ITSMART", start_url: "/" });
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
