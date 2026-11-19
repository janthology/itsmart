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

// The ticket change and comment are still separate requests; exercise partial
// success and ambiguous outcomes without contacting a real backend.
for (const action of ['Status', 'Assignment', 'Priority'] as const) {
  test(`${action} update warns when the activity entry is unconfirmed`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let current = { ...ticket };
    let commentAttempts = 0;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PATCH, POST, OPTIONS' };
    await page.route('**/rest/v1/tickets*', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (req.method() === 'PATCH') {
        current = { ...current, ...req.postDataJSON() };
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify([{ id: ticketId }]) });
      }
      const url = new URL(req.url());
      const value = url.searchParams.get('select') === 'on_hold_at, total_hold_seconds'
        ? { on_hold_at: null, total_hold_seconds: 0 } : current;
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
    });
    await page.route('**/rest/v1/ticket_comments*', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (route.request().method() === 'POST') {
        commentAttempts++;
        return route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic comment failure' }) });
      }
      return route.fallback();
    });
    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByRole('heading', { name: 'Synthetic ticket' })).toBeVisible();
    const management = page.locator('div').filter({ has: page.getByText('Ticket management', { exact: true }) }).filter({ has: page.getByText('Update Status', { exact: true }) }).last();
    const selects = management.getByRole('combobox');
    if (action === 'Status') {
      await selects.nth(0).click();
      await page.getByRole('option', { name: 'Closed' }).click();
      await page.getByPlaceholder(/Reason for closing/).fill('Synthetic closure reason');
      await page.getByRole('button', { name: 'Confirm Close' }).click();
    } else if (action === 'Priority') {
      await selects.nth(1).click();
      await page.getByRole('option', { name: 'High - 2', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    } else {
      await selects.nth(3).click();
      await page.getByRole('option', { name: 'Unassigned', exact: true }).click();
    }
    const warning = page.getByRole('alert').filter({ hasText: `${action} was updated` });
    await expect(warning).toContainText('activity entry could not be confirmed');
    await expect(warning).toContainText('may already have been saved');
    if (action === 'Status') {
      expect(current.status).toBe('closed');
      expect(current.assigned_to).toBe(profiles[1].id);
      await expect(warning).toContainText('Synthetic closure reason');
    }
    if (action === 'Priority') expect(current.priority).toBe('high');
    if (action === 'Assignment') expect(current.assigned_to).toBeNull();
    expect(commentAttempts).toBe(1);
    await warning.getByRole('button', { name: 'Dismiss warning' }).click();
    await expect(warning).toHaveCount(0);
  });
}

test('successful ticket update adds one activity entry', async ({ page }) => {
  await syntheticSession(page, 'administrator');
  let currentStatus = 'open';
  let comments = 0;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PATCH, POST, OPTIONS' };
  await page.route('**/rest/v1/tickets*', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() === 'PATCH') {
      currentStatus = req.postDataJSON().status;
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify([{ id: ticketId }]) });
    }
    const value = new URL(req.url()).searchParams.get('select') === 'on_hold_at, total_hold_seconds'
      ? { on_hold_at: null, total_hold_seconds: 0 } : { ...ticket, status: currentStatus };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.route('**/rest/v1/ticket_comments*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (route.request().method() === 'POST') {
      comments++;
      return route.fulfill({ status: 201, headers });
    }
    return route.fallback();
  });
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /In progress/i }).click();
  await expect(page.getByText('Status updated', { exact: true })).toBeVisible();
  expect(currentStatus).toBe('in_progress');
  expect(comments).toBe(1);
  await expect(page.getByRole('alert').filter({ hasText: 'activity entry could not be confirmed' })).toHaveCount(0);
});

for (const outcome of ['zero rows', 'network error'] as const) {
  test(`unconfirmed ticket update (${outcome}) never creates an activity entry`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let comments = 0;
    let reads = 0;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PATCH, POST, OPTIONS' };
    await page.route('**/rest/v1/tickets*', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (req.method() === 'PATCH') {
        if (outcome === 'network error') return route.abort('failed');
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
      }
      reads++;
      const url = new URL(req.url());
      const value = url.searchParams.get('select') === 'on_hold_at, total_hold_seconds'
        ? { on_hold_at: null, total_hold_seconds: 0 } : ticket;
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
    });
    await page.route('**/rest/v1/ticket_comments*', async route => {
      if (route.request().method() === 'POST') comments++;
      return route.fallback();
    });
    await page.goto(`/tickets/${ticketId}`);
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /In progress/i }).click();
    await expect(page.getByText('Could not confirm the status update. Check the refreshed ticket before retrying.', { exact: true })).toBeVisible();
    expect(comments).toBe(0);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
  });
}

test('unconfirmed status update retains the required remarks for recovery', async ({ page }) => {
  await syntheticSession(page, 'administrator');
  let comments = 0;
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PATCH, POST, OPTIONS' };
  await page.route('**/rest/v1/tickets*', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() === 'PATCH') return route.abort('failed');
    const value = new URL(req.url()).searchParams.get('select') === 'on_hold_at, total_hold_seconds'
      ? { on_hold_at: null, total_hold_seconds: 0 } : ticket;
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.route('**/rest/v1/ticket_comments*', async route => {
    if (route.request().method() === 'POST') comments++;
    return route.fallback();
  });
  await page.goto(`/tickets/${ticketId}`);
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Closed' }).click();
  await page.getByPlaceholder(/Reason for closing/).fill('Keep this reason safe');
  await page.getByRole('button', { name: 'Confirm Close' }).click();
  const warning = page.getByRole('alert').filter({ hasText: 'No activity entry was attempted' });
  await expect(warning).toContainText('Keep this reason safe');
  expect(comments).toBe(0);
});

for (const failure of ['cleanup_unconfirmed', 'cleanup_requested', 'lost_response'] as const) {
  test(`user creation ${failure} warns and blocks an unchecked retry`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let attempts = 0;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    await page.route('**/functions/v1/create-user', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      attempts++;
      if (failure === 'lost_response') return route.abort('failed');
      return route.fulfill({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ code: failure, error: 'Synthetic failure', userId: profiles[2].id }) });
    });
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByPlaceholder('e.g. Juan dela Cruz').fill('Synthetic New User');
    await page.getByPlaceholder('name@dost.gov.ph').fill('new@example.test');
    await page.getByRole('button', { name: 'Create user' }).click();
    const warning = page.getByRole('alert').filter({ hasText: 'User creation needs review' });
    await expect(warning).toContainText('new@example.test');
    await expect(warning).toContainText('before retrying');
    if (failure !== 'lost_response') await expect(warning).toContainText(profiles[2].id);
    await expect(page.getByRole('button', { name: 'Create user' })).toBeDisabled();
    expect(attempts).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'User creation needs review' })).toBeVisible();
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByRole('button', { name: 'I checked; allow retry' }).click();
    await expect(page.getByRole('button', { name: 'Create user' })).toBeEnabled();
    expect(attempts).toBe(1);
  });
}

test('successful user creation displays the one-time password', async ({ page }) => {
  await syntheticSession(page, 'administrator');
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route('**/functions/v1/create-user', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, userId: profiles[2].id, temporaryPassword: 'SyntheticPassword2!' }) });
  });
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  await page.getByPlaceholder('e.g. Juan dela Cruz').fill('Synthetic New User');
  await page.getByPlaceholder('name@dost.gov.ph').fill('new@example.test');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('SyntheticPassword2!', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'User creation needs review' })).toHaveCount(0);
});

async function selectUserAndReset(page: Page) {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: /Synthetic User.*General User/i }).click();
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Reset password', exact: true }).click();
}

for (const failure of ['profile_unconfirmed', 'reset_unconfirmed', 'lost_response', 'missing_password'] as const) {
  test(`password reset ${failure} warns and does not silently retry`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let attempts = 0;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    await page.route('**/functions/v1/reset-password', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      attempts++;
      if (failure === 'lost_response') return route.abort('failed');
      if (failure === 'missing_password') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ code: failure }) });
    });
    await selectUserAndReset(page);
    const warning = page.getByRole('alert').filter({ hasText: 'Password reset needs review: Synthetic User' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(failure === 'profile_unconfirmed' ? 'did not attempt' : 'may have changed');
    expect(attempts).toBe(1);
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset password', exact: true }).click();
    await expect(page.getByText('Check the account first', { exact: true })).toBeVisible();
    expect(attempts).toBe(1);
    await warning.getByRole('button', { name: 'I checked; allow password retry' }).click();
    await expect(warning).toHaveCount(0);
  });
}

for (const profileFlag of ['confirmed', 'unconfirmed'] as const) {
  test(`successful password reset keeps password visible and flags ${profileFlag} status`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    await page.route('**/functions/v1/reset-password', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ success: true, temporaryPassword: 'SyntheticPassword2!', profileFlag, sessionRevocation: 'unverified' }) });
    });
    await selectUserAndReset(page);
    await expect(page.getByText('SyntheticPassword2!', { exact: true })).toBeVisible();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toContainText('Session revocation is not verified');
    if (profileFlag === 'unconfirmed') await expect(dialog.getByRole('alert')).toContainText('password-change flag could not be confirmed');
    else await expect(dialog.getByRole('alert')).not.toContainText('password-change flag could not be confirmed');
    await dialog.getByRole('button', { name: 'Done' }).click();
    if (profileFlag === 'unconfirmed') await expect(page.getByRole('alert').filter({ hasText: 'Password reset needs review' })).toBeVisible();
  });
}

test('report fetch failure displays retry and prevents export until recovered', async ({ page }) => {
  await syntheticSession(page, 'general_user');
  let fail = true;
  await page.route('**/rest/v1/tickets*', async route => {
    if (!fail) return route.fallback();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic report failure' }) });
  });
  await page.goto('/reports');
  await expect(page.getByRole('alert')).toContainText('Could not load report data.', { timeout: 10000 });
  await expect(page.getByText('No data for this report')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
});

for (const item of [
  { name: 'asset inventory', table: 'assets', button: null, select: null },
  { name: 'asset history', table: 'asset_history', button: 'History', select: null },
  { name: 'ticket performance', table: 'tickets', button: 'Performance', select: null },
  { name: 'user activity', table: 'assets', button: 'User activity', select: 'assigned_to' },
] as const) {
  test(`report errors and retry: ${item.name}`, async ({ page }) => {
    await syntheticSession(page, 'administrator');
    let fail = true;
    await page.route(`**/rest/v1/${item.table}*`, async route => {
      const url = new URL(route.request().url());
      if (!fail || (item.select && url.searchParams.get('select') !== item.select)) return route.fallback();
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic report failure' }) });
    });
    await page.goto('/reports');
    if (item.button) await page.getByRole('button', { name: new RegExp(item.button, 'i') }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load report data.', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
