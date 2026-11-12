import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

type Role = 'administrator' | 'support_staff' | 'general_user';
const profiles = [
  { id: '00000000-0000-4000-8000-000000000001', full_name: 'Synthetic Admin', role: 'administrator', is_active: true, department: 'IT', email: 'admin@example.test', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000002', full_name: 'Synthetic Support', role: 'support_staff', is_active: true, department: 'IT', email: 'support@example.test', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000003', full_name: 'Synthetic User', role: 'general_user', is_active: true, department: 'Field', email: 'user@example.test', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
] as const;
const assetId = '00000000-0000-4000-8000-000000000004';
const ticketId = '00000000-0000-4000-8000-000000000005';
const asset = { id: assetId, asset_tag: 'TEST-ASSET', name: 'Synthetic laptop', category: 'laptop', status: 'active', assigned_to: profiles[2].id, assigned_to_profile: profiles[2], last_pm_date: '2025-01-01', next_pm_date: '2027-01-01', pm_required: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' };
const ticket = { id: ticketId, ticket_number: 'TEST-TICKET', title: 'Synthetic ticket', description: 'Synthetic issue', status: 'open', priority: 'medium', type: 'hardware_issue', created_by: profiles[2].id, assigned_to: profiles[1].id, created_by_profile: profiles[2], assigned_to_profile: profiles[1], asset: null, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', comments: [] };

async function syntheticSession(page: Page, role: Role, mustChangePassword = false) {
  const profile = profiles.find(p => p.role === role)!;
  const user = { id: profile.id, email: profile.email, created_at: profile.created_at, app_metadata: { role }, user_metadata: { full_name: profile.full_name }, aud: 'authenticated', role: 'authenticated' };
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800 })).toString('base64url')}.signature`;
  await page.addInitScript(({ user, token }) => localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fake-refresh', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user })), { user, token });
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'example.supabase.co') return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-expose-headers': 'content-range', 'content-range': '0-0/1' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers });
    // Fail closed: tests cannot write even to the dummy service.
    if (req.method() !== 'GET') return route.fulfill({ status: 403, headers, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic test: writes disabled' }) });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(user) });
    const single = (req.headers()['accept'] ?? '').includes('application/vnd.pgrst.object');
    let result: unknown = [];
    if (url.pathname === '/rest/v1/profiles' && url.searchParams.get('select') === 'must_change_password') result = { must_change_password: mustChangePassword };
    else if (url.pathname === '/rest/v1/profiles' && url.searchParams.get('select') === 'password_changed_at') result = { password_changed_at: null };
    else if (url.pathname === '/rest/v1/profiles' || url.pathname === '/rest/v1/profiles_with_email') result = single ? profile : profiles;
    else if (url.pathname === '/rest/v1/assets') result = single ? asset : [asset];
    else if (url.pathname === '/rest/v1/tickets') result = single ? ticket : [ticket];
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return pageErrors;
}

for (const role of ['administrator', 'support_staff', 'general_user'] as const) {
  test(`${role}: all common pages render without uncaught exceptions`, async ({ page }) => {
    const errors = await syntheticSession(page, role);
    const routes: [string, RegExp][] = [
      ['/dashboard', /Good (morning|afternoon|evening)/i], ['/assets', /Asset.*fleet/i], [`/assets/${assetId}`, /Synthetic laptop/i],
      ['/tickets', /Support.*Tickets/i], [`/tickets/${ticketId}`, /Synthetic ticket/i],
      ['/calendar', /Calendar/i], ['/reports', /Reports & exports/i],
      ['/profile', /Personal Information/i], ['/change-password', /Change Password/i],
      ['/not-a-real-page', /Page not found/i],
    ];
    for (const [path, content] of routes) {
      await page.goto(path);
      await expect(page.getByText(content).filter({ visible: true }).first(), `page ${path}`).toBeVisible();
      await expect(page.getByText('Something went wrong', { exact: false })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test(`${role}: user management access follows role`, async ({ page }) => {
    await syntheticSession(page, role);
    await page.goto('/admin/users');
    if (role === 'administrator') await expect(page.getByRole('heading', { name: /User management/i })).toBeVisible();
    else await expect(page).toHaveURL(/\/dashboard$/);
  });

  test(`${role}: ticket and report controls follow role`, async ({ page }) => {
    await syntheticSession(page, role);
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByRole('heading', { name: 'Synthetic ticket' })).toBeVisible();
    if (role === 'general_user') {
      await expect(page.getByText('Ticket management', { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText('Ticket management', { exact: true })).toBeVisible();
      await expect(page.getByText('Type', { exact: true }).first()).toBeVisible();
    }
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Reports & exports/i })).toBeVisible();
    if (role === 'general_user') await expect(page.getByRole('button', { name: /Performance/i })).toHaveCount(0);
    else await expect(page.getByRole('button', { name: /Performance/i })).toBeVisible();
  });
}

test('AUDIT: password inputs have programmatically associated labels', async ({ page }) => {
  await syntheticSession(page, 'general_user');
  await page.goto('/change-password');
  await expect(page.getByPlaceholder('Your current password')).toBeVisible();
  await expect(page.getByLabel('Current Password', { exact: true })).toBeVisible({ timeout: 1500 });
  await expect(page.getByLabel('New Password', { exact: true })).toBeVisible({ timeout: 1500 });
  await expect(page.getByLabel('Confirm New Password', { exact: true })).toBeVisible({ timeout: 1500 });
  await page.getByRole('button', { name: 'Show current password' }).click();
  await expect(page.getByLabel('Current Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide current password' })).toBeVisible();
  await page.getByRole('button', { name: 'Show new password' }).click();
  await expect(page.getByRole('button', { name: 'Hide new password' })).toBeVisible();
});

for (const { table, tab, error, empty } of [
  { table: 'asset_maintenance_log', tab: 'Maintenance', error: 'Could not load maintenance records.', empty: 'No maintenance records yet.' },
  { table: 'asset_history', tab: 'History', error: 'Could not load asset history.', empty: 'No history recorded yet.' },
]) {
  test(`${tab} load errors are distinct from empty results and can be retried`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let fail = true;
    await page.route(`**/rest/v1/${table}*`, async route => {
      if (!fail) return route.fallback();
      await route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic database failure' }) });
    });
    await page.goto(`/assets/${assetId}`);
    await page.getByRole('button', { name: new RegExp(tab) }).click();
    await expect(page.getByText(error)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(empty)).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText(empty)).toBeVisible();
  });
}

test('mobile layout audit: common pages fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await syntheticSession(page, 'general_user');
  const routes: [string, RegExp][] = [
    ['/dashboard', /Good (morning|afternoon|evening)/i], ['/assets', /Asset.*fleet/i],
    [`/assets/${assetId}`, /Synthetic laptop/i], ['/tickets', /Support.*Tickets/i],
    [`/tickets/${ticketId}`, /Synthetic ticket/i], ['/calendar', /Calendar/i],
    ['/reports', /Reports & exports/i], ['/profile', /Personal Information/i], ['/change-password', /Change Password/i],
  ];
  for (const [path, content] of routes) {
    await page.goto(path);
    await expect(page.getByText(content).filter({ visible: true }).first(), `page ${path}`).toBeVisible();
    const sizes = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(sizes.scrollWidth, `${path} horizontal document overflow`).toBeLessThanOrEqual(sizes.clientWidth + 1);
  }
});

for (const failure of ['403', 'no-row'] as const) {
  test(`password update recovers from profile update ${failure} without changing password twice`, async ({ page }) => {
    await syntheticSession(page, 'general_user', true);
    const profile = profiles[2];
    const user = { id: profile.id, email: profile.email, created_at: profile.created_at, app_metadata: { role: profile.role }, user_metadata: { full_name: profile.full_name }, aud: 'authenticated', role: 'authenticated' };
    const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800 })).toString('base64url')}.signature`;
    const session = { access_token: token, refresh_token: 'fake-refresh', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user };
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS' };
    let authUpdates = 0;
    let profileUpdates = 0;
    const profilePayloads: { must_change_password: boolean; password_changed_at: string }[] = [];
    await page.route('**/auth/v1/token*', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(session) });
    });
    await page.route('**/auth/v1/user', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (route.request().method() === 'PUT') { authUpdates++; return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(user) }); }
      return route.fallback();
    });
    await page.route('**/rest/v1/profiles*', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (route.request().method() === 'PATCH') {
        profileUpdates++;
        profilePayloads.push(route.request().postDataJSON());
        if (profileUpdates === 1) return route.fulfill({ status: failure === '403' ? 403 : 200, headers, contentType: 'application/json', body: JSON.stringify(failure === '403' ? { message: 'Synthetic profile update failed' } : []) });
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify([{ id: profile.id }]) });
      }
      return route.fallback();
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel('Current Password', { exact: true }).fill('OldPassword1!');
    await page.getByLabel('New Password', { exact: true }).fill('NewPassword2!');
    await page.getByLabel('Confirm New Password', { exact: true }).fill('NewPassword2!');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByRole('alert')).toContainText('Your new password is active');
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByLabel('Current Password', { exact: true })).toHaveCount(0);
    expect(authUpdates).toBe(1);
    await page.getByRole('button', { name: 'Retry account update' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(profileUpdates).toBe(2);
    expect(profilePayloads[0].must_change_password).toBe(false);
    expect(profilePayloads[1]).toEqual(profilePayloads[0]);
    expect(authUpdates).toBe(1);
  });
}


test('depreciation preview and downloads handle zero-cost and future assets', async ({ page }) => {
  await syntheticSession(page, 'administrator');
  await page.route('**/rest/v1/assets*', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', 'content-range': '0-1/2' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const assets = [
      { ...asset, id: 'future', asset_tag: 'FUTURE', name: 'Future asset', purchase_date: '2099-01-01', purchase_value: 5000 },
      { ...asset, id: 'zero', asset_tag: 'ZERO', name: 'Zero cost', purchase_date: '2020-01-01', purchase_value: 0 },
    ];
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(assets) });
  });
  await page.goto('/reports');
  await page.getByRole('button', { name: /Depreciation/ }).click();
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'FUTURE' })).toContainText('₱5,000');
  await expect(rows.filter({ hasText: 'FUTURE' })).toContainText('0%');
  await expect(rows.filter({ hasText: 'ZERO' })).toContainText('N/A');
  const [xlsxDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Excel/ }).click()]);
  const workbook = XLSX.read(await readFile(await xlsxDownload.path()));
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Depreciation, { defval: '' });
  expect(data.map(r => [r['Asset Tag'], r['Current Value (₱)'], r['% Depreciated']])).toEqual([['FUTURE', 5000, 0], ['ZERO', 0, '']]);
  const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const pdf = await readFile(await pdfDownload.path());
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain('(N/A)');
});
