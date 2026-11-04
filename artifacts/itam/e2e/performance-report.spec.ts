import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

// The CI build uses example.supabase.co. Intercept it completely so this test
// uses synthetic records and cannot read from or write to a real project.
test("performance preview and exports agree on hold time, boundaries and direct closure", async ({ page }) => {
  const user = {
    id: "00000000-0000-4000-8000-000000000001", email: "admin@example.test", created_at: "2026-01-01T00:00:00Z",
    app_metadata: { role: "administrator" }, user_metadata: { full_name: "Test Admin" },
    aud: "authenticated", role: "authenticated",
  };
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800 })).toString("base64url")}.signature`;
  await page.addInitScript(({ user, token }) => {
    localStorage.setItem("sb-example-auth-token", JSON.stringify({
      access_token: token, refresh_token: "test-refresh", expires_in: 3600, expires_at: 4102444800,
      token_type: "bearer", user,
    }));
  }, { user, token });

  const base = {
    description: "Synthetic test", priority: "high", created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T10:00:00Z", created_by_profile: { id: user.id, full_name: "Test Admin", role: "administrator" },
    assigned_to_profile: null, asset: null,
  };
  const tickets = [
    { ...base, id: "ticket-1", ticket_number: "TEST-1", title: "Held ticket", status: "resolved", resolved_at: "2026-01-01T10:00:00Z", total_hold_seconds: 14400 },
    { ...base, id: "ticket-2", ticket_number: "TEST-2", title: "Boundary ticket", status: "resolved", resolved_at: "2026-01-01T08:00:10Z", total_hold_seconds: 0 },
    { ...base, id: "ticket-3", ticket_number: "TEST-3", title: "Directly closed", status: "closed", resolved_at: null, total_hold_seconds: 0 },
    { ...base, id: "ticket-4", ticket_number: "TEST-4", title: "Open ticket", status: "open", resolved_at: null, total_hold_seconds: 0 },
  ];

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    // Never let a misconfigured local build contact a real project or third party.
    if (url.hostname !== "example.supabase.co") return route.abort();
    const path = url.pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, OPTIONS" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (request.method() !== "GET") throw new Error(`Unexpected request: ${request.method()} ${path}`);
    const ticketId = url.searchParams.get("id")?.replace(/^eq\./, "");
    const singleTicket = ticketId ? tickets.find((ticket) => ticket.id === ticketId) : undefined;
    const body = path === "/rest/v1/profiles" && url.searchParams.get("select") === "must_change_password"
      ? { must_change_password: false }
      : path === "/rest/v1/tickets" ? (singleTicket ? { ...singleTicket, comments: [] } : tickets) : [];
    await route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/reports");
  await page.getByRole("button", { name: /Performance/ }).click();
  await expect(page.getByText("1 SLA met")).toBeVisible();
  await expect(page.getByText("1 breached", { exact: true })).toBeVisible();
  await expect(page.getByText("1 pending", { exact: true })).toBeVisible();
  await expect(page.getByText("1 closed without resolution", { exact: true })).toBeVisible();
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("6");
  await expect(rows.nth(0)).toContainText("Met");
  await expect(rows.nth(1)).toContainText("Breached");
  await expect(rows.nth(2)).toContainText("Closed without resolution");
  await expect(rows.nth(3)).toContainText("Pending");

  const [xlsxDownload] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: /Excel/ }).click(),
  ]);
  const workbook = XLSX.read(await readFile(await xlsxDownload.path()));
  expect(workbook.SheetNames).toEqual(["Performance", "Notes"]);
  const excelRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Performance, { defval: "" });
  expect(excelRows.map((r) => [r["Resolution Time (h)"], r["SLA Status"]])).toEqual([
    [6, "Met"], [8, "Breached"], ["", "Closed without resolution"], ["", "Pending"],
  ]);
  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  const pdf = await readFile(await pdfDownload.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.toString("latin1")).toContain("(Breached)");
  expect(pdf.toString("latin1")).toContain("(Met)");

  // The ticket badge uses the same direct-closure policy as the report.
  await page.goto("/tickets/ticket-3");
  const directBadge = page.getByText("SLA not applicable", { exact: true }).locator("../..");
  await expect(directBadge).toContainText("Closed without resolution");
  await expect(directBadge).not.toContainText("Deadline");
  await expect(directBadge).not.toContainText("Target");
  await page.goto("/tickets/ticket-1");
  await expect(page.getByText("Resolved in 6h", { exact: true })).toBeVisible();
  await expect(page.getByText("SLA not applicable", { exact: true })).toHaveCount(0);
});
