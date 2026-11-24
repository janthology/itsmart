// Signed-in role matrix for the trusted password gate (docs/password-gate-phase3-review.md, section 7).
// Run from your own machine, against the live project, with the three DEDICATED test accounts only.
// It does not run against the retained administrator. Zero dependencies (Node 18+).
//
// Required environment:
//   SUPABASE_URL            e.g. https://rkwxdqludtdzbpuftsvi.supabase.co
//   SUPABASE_ANON_KEY       the publishable/anon key the app uses
//   ADMIN_EMAIL, ADMIN_PASSWORD        (administrator, admintest)
//   SUPPORT_EMAIL, SUPPORT_PASSWORD    (support_staff, supporttest)
//   USER_EMAIL, USER_PASSWORD          (general_user, usertest)
// Optional:
//   --lockout   also sends 5 wrong passwords for USER_EMAIL to check the lockout (locks that account 15 minutes)
//
// It only reads. It prints PASS, FAIL or NOTE for each check. Expected results are in the comments.
// No password or token is printed.

const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const anon = process.env.SUPABASE_ANON_KEY ?? '';
const accounts = {
  admin: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  support: { email: process.env.SUPPORT_EMAIL, password: process.env.SUPPORT_PASSWORD },
  user: { email: process.env.USER_EMAIL, password: process.env.USER_PASSWORD },
};
if (!base || !anon || Object.values(accounts).some(a => !a.email || !a.password)) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and the email and password of the three dedicated accounts.');
  process.exit(2);
}
const runLockout = process.argv.includes('--lockout');

let failures = 0;
const results = [];
function report(status, name, detail = '') {
  if (status === 'FAIL') failures++;
  results.push(status);
  console.log(`${status.padEnd(4)} ${name}${detail ? ` (${detail})` : ''}`);
}
function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function broker(email, password) {
  const r = await fetch(`${base}/functions/v1/login-broker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon },
    body: JSON.stringify({ email, password }),
  });
  let body = {};
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}
async function rest(path, token) {
  const r = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}` },
  });
  let body = null;
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}

// 1. Sign in through the broker. Expect 200 and a token whose session is admitted.
const tokens = {};
for (const [role, account] of Object.entries(accounts)) {
  const r = await broker(account.email, account.password);
  if (r.status === 200 && typeof r.body.access_token === 'string') {
    tokens[role] = r.body.access_token;
    report('PASS', `${role}: broker sign-in returns tokens`, `password_change_required=${r.body.password_change_required}`);
  } else {
    report('FAIL', `${role}: broker sign-in returns tokens`, `status ${r.status} ${r.body.code ?? ''}`);
  }
}

// 2. Full-scope role reads. Expect the role's business data to be readable.
if (tokens.admin) {
  const t = await rest('tickets?select=id&limit=5', tokens.admin);
  report(t.status === 200 && Array.isArray(t.body) ? 'PASS' : 'FAIL', 'admin: reads tickets', `status ${t.status}, rows ${Array.isArray(t.body) ? t.body.length : 'n/a'}`);
  const a = await rest('assets?select=id&limit=5', tokens.admin);
  report(a.status === 200 && Array.isArray(a.body) ? 'PASS' : 'FAIL', 'admin: reads assets', `status ${a.status}`);
  const p = await rest('profiles?select=id', tokens.admin);
  report(p.status === 200 && Array.isArray(p.body) && p.body.length > 1 ? 'PASS' : 'FAIL', 'admin: reads all profiles', `rows ${Array.isArray(p.body) ? p.body.length : 'n/a'}`);
}
if (tokens.support) {
  const t = await rest('tickets?select=id&limit=5', tokens.support);
  report(t.status === 200 && Array.isArray(t.body) ? 'PASS' : 'FAIL', 'support: reads tickets', `status ${t.status}`);
  const a = await rest('assets?select=id&limit=5', tokens.support);
  report(a.status === 200 && Array.isArray(a.body) ? 'PASS' : 'FAIL', 'support: reads assets', `status ${a.status}`);
}

// 3. General user: own tickets only. Expect every returned ticket to be created by this user.
if (tokens.user) {
  const me = claimsOf(tokens.user).sub;
  const t = await rest('tickets?select=id,created_by&limit=50', tokens.user);
  const others = Array.isArray(t.body) ? t.body.filter(x => x.created_by !== me).length : -1;
  report(t.status === 200 && others === 0 ? 'PASS' : 'FAIL', 'general user: only own tickets', `status ${t.status}, rows ${Array.isArray(t.body) ? t.body.length : 'n/a'}, other users' rows ${others}`);
  const pr = await rest(`profiles?select=id,must_change_password&id=eq.${me}`, tokens.user);
  report(pr.status === 200 && Array.isArray(pr.body) && pr.body.length === 1 ? 'PASS' : 'FAIL', 'general user: reads own profile only', `rows ${Array.isArray(pr.body) ? pr.body.length : 'n/a'}`);
  const others2 = await rest('profiles?select=id', tokens.user);
  report(others2.status === 200 && Array.isArray(others2.body) && others2.body.length === 1 ? 'PASS' : 'FAIL', 'general user: other profiles not visible', `rows ${Array.isArray(others2.body) ? others2.body.length : 'n/a'}`);
}

// 4. Unadmitted session: a password grant made directly, without the broker. Expect no business rows.
{
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon },
    body: JSON.stringify({ email: accounts.admin.email, password: accounts.admin.password }),
  });
  const body = await r.json().catch(() => ({}));
  if (typeof body.access_token === 'string') {
    const t = await rest('tickets?select=id&limit=5', body.access_token);
    const n = Array.isArray(t.body) ? t.body.length : -1;
    report(n === 0 || t.status === 401 || t.status === 403 ? 'PASS' : 'FAIL', 'unadmitted session (no broker): no business rows', `status ${t.status}, rows ${n}`);
    await fetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${body.access_token}` } });
  } else {
    report('NOTE', 'unadmitted session: direct sign-in refused by GoTrue', `status ${r.status}`);
  }
}

// 5. Anonymous: no business rows.
{
  const t = await rest('tickets?select=id&limit=5', null);
  const n = Array.isArray(t.body) ? t.body.length : -1;
  report(n === 0 || t.status === 401 || t.status === 403 ? 'PASS' : 'FAIL', 'anon: no business rows', `status ${t.status}, rows ${n}`);
}

// 6. Wrong password through the broker: 401 login_failed, and no tokens.
{
  const r = await broker(accounts.user.email, 'definitely-wrong-password-for-test');
  report(r.status === 401 && r.body.code === 'login_failed' && !r.body.access_token ? 'PASS' : 'FAIL', 'wrong password: login_failed, no tokens', `status ${r.status} ${r.body.code ?? ''}`);
}

// 7. Lockout (optional, because it locks USER_EMAIL for 15 minutes).
if (runLockout) {
  let refused = 0;
  for (let i = 0; i < 6; i++) {
    const r = await broker(accounts.user.email, 'definitely-wrong-password-for-test');
    if (r.status === 429) refused++;
  }
  report(refused >= 1 ? 'PASS' : 'FAIL', 'lockout: repeated wrong passwords get 429', `429 responses ${refused} of 6`);
  const right = await broker(accounts.user.email, accounts.user.password);
  report(right.status === 429 ? 'PASS' : 'FAIL', 'lockout: correct password refused while locked', `status ${right.status}`);
} else {
  report('NOTE', 'lockout not run (pass --lockout to run it; it locks USER_EMAIL for 15 minutes)');
}

console.log(`\n${results.filter(s => s === 'PASS').length} passed, ${failures} failed, ${results.filter(s => s === 'NOTE').length} notes.`);
process.exit(failures > 0 ? 1 : 0);
