import { test, expect, type Page } from '@playwright/test';

const adminId = '00000000-0000-4000-8000-000000000001';
const staffId = '00000000-0000-4000-8000-000000000002';
const generalId = '00000000-0000-4000-8000-000000000003';
const assetId = '00000000-0000-4000-8000-000000000004';
const people = [
  { id: adminId, full_name: 'Test Admin', role: 'administrator', is_active: true },
  { id: staffId, full_name: 'Test Staff', role: 'support_staff', is_active: true },
  { id: generalId, full_name: 'Test User', role: 'general_user', is_active: true },
];

async function setup(page: Page, role: 'administrator' | 'support_staff' | 'general_user', status = 'active') {
  const person = people.find(p => p.role === role)!;
  const user = { id: person.id, email: 'test@example.test', created_at: '2025-01-01T00:00:00Z', app_metadata: { role }, user_metadata: { full_name: person.full_name }, aud: 'authenticated', role: 'authenticated' };
  const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800 })).toString('base64url')}.signature`;
  await page.addInitScript(({ user, token }) => localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user })), { user, token });
  const requests: { path: string; body: any }[] = [];
  const asset = { id: assetId, asset_tag: 'TEST-001', name: 'Test laptop', category: 'laptop', status, assigned_to: generalId, assigned_to_profile: people[2], last_pm_date: '2025-01-01', next_pm_date: '2025-07-01', pm_required: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' };
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== 'example.supabase.co') return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() !== 'GET') {
      requests.push({ path: url.pathname, body: req.postDataJSON() });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: url.pathname.includes('/rpc/') ? 'null' : '[]' });
    }
    let body: unknown = [];
    if (url.pathname === '/rest/v1/profiles' && url.searchParams.get('select') === 'must_change_password') body = { must_change_password: false };
    else if (url.pathname === '/rest/v1/profiles_with_email' || url.pathname === '/rest/v1/profiles') body = people;
    else if (url.pathname === '/rest/v1/assets') body = asset;
    else if (url.pathname === '/rest/v1/asset_maintenance_log') body = [{ id: 'entry-1', asset_id: assetId, performed_at: '2025-01-01', maintenance_type: 'corrective', description: 'Repaired fan', performed_by_profile: people[1], created_by_profile: people[0] }];
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/assets/${assetId}`);
  await expect(page.getByRole('heading', { name: 'Test laptop' })).toBeVisible();
  return requests;
}

test('support staff can log corrective work and update both PM dates', async ({ page }) => {
  const requests = await setup(page, 'support_staff');
  await page.getByRole('button', { name: /Maintenance/ }).click();
  await expect(page.getByText('Repaired fan')).toBeVisible();
  await page.getByLabel('Last PM date', { exact: true }).fill('2025-02-01');
  await page.getByLabel('Next PM date', { exact: true }).first().fill('2025-08-01');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect.poll(() => requests.find(r => r.path.endsWith('/update_asset_pm_schedule'))?.body).toMatchObject({ p_last: '2025-02-01', p_next: '2025-08-01', p_required: true });
  await page.getByLabel('Maintenance type').selectOption('corrective');
  await page.getByLabel('Date Performed').fill('2025-03-01');
  await page.getByLabel('Performed By').selectOption(staffId);
  await page.getByLabel('Work description').fill('Replaced a fan');
  await page.getByRole('button', { name: 'Add Record' }).click();
  await expect.poll(() => requests.find(r => r.path.endsWith('/record_asset_maintenance'))?.body).toMatchObject({ p_type: 'corrective', p_performed_by: staffId, p_description: 'Replaced a fan', p_next_pm_date: null });
});

test('general users can read maintenance but cannot change it', async ({ page }) => {
  await setup(page, 'general_user');
  await page.getByRole('button', { name: /Maintenance/ }).click();
  await expect(page.getByText('Repaired fan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Record' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save schedule' })).toHaveCount(0);
});

test('admin entering maintenance keeps the existing assignment', async ({ page }) => {
  const requests = await setup(page, 'administrator');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const status = page.getByRole('combobox').filter({ hasText: 'Active' });
  await status.click();
  await page.getByRole('option', { name: 'Maintenance', exact: true }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => requests.find(r => r.path === '/rest/v1/assets')?.body).toMatchObject({ status: 'maintenance' });
  expect(requests.find(r => r.path === '/rest/v1/assets')?.body).not.toHaveProperty('assigned_to');
});

test('preventive work proposes category schedule and requires work details', async ({ page }) => {
  const requests = await setup(page, 'support_staff');
  await page.getByRole('button', { name: /Maintenance/ }).click();
  await expect(page.getByRole('button', { name: 'Add Record' })).toBeDisabled();
  await page.getByLabel('Date Performed').fill('2025-01-31');
  await page.getByLabel('Performed By').selectOption(staffId);
  await page.getByLabel('Work description').fill('Cleaned and inspected');
  await expect(page.locator('#pm-next-date')).toHaveValue('2025-07-31');
  await page.getByRole('button', { name: 'Add Record' }).click();
  await expect.poll(() => requests.find(r => r.path.endsWith('/record_asset_maintenance'))?.body).toMatchObject({ p_type: 'preventive', p_next_pm_date: '2025-07-31' });
});

test('admins can submit a reasoned correction to a maintenance record', async ({ page }) => {
  const requests = await setup(page, 'administrator');
  await page.getByRole('button', { name: /Maintenance/ }).click();
  await page.getByRole('button', { name: 'Correct details' }).click();
  await page.getByLabel('Work description', { exact: true }).fill('Cleaned fan');
  await page.getByLabel('Reason for correction').fill('Clarify work');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect.poll(() => requests.find(r => r.path.endsWith('/correct_asset_maintenance'))?.body).toMatchObject({ p_description: 'Cleaned fan', p_reason: 'Clarify work' });
});


test('only admins can return a maintained asset to service', async ({ page }) => {
  const requests = await setup(page, 'administrator', 'maintenance');
  await page.getByRole('button', { name: 'Return to service' }).click();
  await expect.poll(() => requests.find(r => r.path.endsWith('/return_asset_to_service'))?.body).toMatchObject({ p_asset_id: assetId });
});
