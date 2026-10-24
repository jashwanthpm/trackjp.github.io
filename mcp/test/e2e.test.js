// End-to-end: a pretend AI app connects through Google sign-in and uses the tools.
//   npm run test:e2e   (starts the real Worker locally + a fake Supabase defined below)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';   // the local dev server uses a throw-away certificate
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';

// ---- Fake Supabase: only the endpoints the MCP server talks to ----
// A tiny stand-in for the parts of Supabase the MCP server talks to.

function startFakeSupabase(port) {
  const NOW = Date.now();
  const iso = d => new Date(d).toISOString();
  const day = n => iso(NOW + n * 86400000).slice(0, 10);
  const USERS = {
    'user-a': { id: 'user-a', email: 'a@example.com', created_at: '2025-01-01T00:00:00Z' },
    'user-b': { id: 'user-b', email: 'b@example.com', created_at: '2025-01-01T00:00:00Z' },
    'user-new': { id: 'user-new', email: 'new@example.com', created_at: iso(NOW) }   // account created by this very sign-in
  };
  const SHOOTS = [
    { id: 's1', user_id: 'user-a', name: 'Past wedding, unpaid', date: day(-20), amount: 50000, pay_status: 'pending', part_paid: 0, event: 'Wedding', booking_status: 'confirmed' },
    { id: 's2', user_id: 'user-a', name: 'Past shoot, part paid', date: day(-10), amount: 40000, pay_status: 'part', part_paid: 10000, event: 'Portrait', booking_status: 'confirmed' },
    { id: 's3', user_id: 'user-a', name: 'Upcoming, advance paid', date: day(15), amount: 80000, pay_status: 'part', part_paid: 20000, event: 'Wedding', booking_status: 'confirmed' },
    { id: 's4', user_id: 'user-a', name: 'Past, fully paid', date: day(-40), amount: 30000, pay_status: 'done', part_paid: 0, event: 'Event', booking_status: 'confirmed' },
    { id: 'sb', user_id: 'user-b', name: "Someone else's secret shoot", date: day(5), amount: 99999, pay_status: 'pending', part_paid: 0, event: 'Private', booking_status: 'confirmed' }
  ];
  const state = { leak: false, calls: [], tokens: new Map(), refresh: new Map(), n: 0 };

  const sessionFor = (uid, provider = 'google') => {
    const n = ++state.n, u = USERS[uid];
    const s = {
      access_token: `at-${uid}-${n}`, refresh_token: `rt-${uid}-${n}`, expires_in: 3600,
      user: { ...u, app_metadata: { provider, providers: [provider] }, identities: [{ provider }] }
    };
    state.tokens.set(s.access_token, uid);
    state.refresh.set(s.refresh_token, { uid, provider });
    return s;
  };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    state.calls.push(`${req.method} ${url.pathname}${url.searchParams.get('grant_type') ? '?grant_type=' + url.searchParams.get('grant_type') : ''}`);
    if (req.headers.apikey !== 'test-anon-key') return send(res, 401, { message: 'bad apikey' });

    if (url.pathname === '/auth/v1/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'id_token') {
        const m = /^fake-(google|email):(user-[a-z]+)$/.exec(body.id_token || '');
        if (!m || body.provider !== 'google' || !USERS[m[2]]) return send(res, 400, { msg: 'invalid id token' });
        return send(res, 200, sessionFor(m[2], m[1]));
      }
      if (grant === 'refresh_token') {
        const r = state.refresh.get(body.refresh_token);
        if (!r) return send(res, 400, { msg: 'invalid refresh token' });
        state.refresh.delete(body.refresh_token);            // rotation, like real Supabase
        return send(res, 200, sessionFor(r.uid, r.provider));
      }
      return send(res, 400, { msg: 'unsupported grant (passwords are not accepted here)' });
    }
    if (url.pathname === '/auth/v1/user') {
      const uid = state.tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      return uid ? send(res, 200, { ...USERS[uid], is_anonymous: false }) : send(res, 401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/rest/v1/settings') {
      const uid = state.tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!uid) return send(res, 401, { message: 'JWT expired' });
      const want = url.searchParams.get('user_id')?.replace('eq.', '');
      const rows = [{ user_id: 'user-a', key: 'user-a_companies', value: ['With Love'] }]
        .filter(x => x.user_id === uid && (!want || x.user_id === want));
      return send(res, 200, rows.map(({key,value})=>({key,value})));
    }
    if (url.pathname === '/rest/v1/edits') {
      const uid = state.tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!uid) return send(res, 401, { message: 'JWT expired' });
      const want = url.searchParams.get('user_id')?.replace('eq.', '');
      const rows = [
        { id: 'e1', user_id: 'user-a', company_name: 'TARA Weddings', client_name: 'Test edit', date: day(-5), amount: 8000, pay_status: 'part', part_paid: 3000, work_status: 'inprogress' },
        { id: 'eb', user_id: 'user-b', company_name: 'Private editing', date: day(-5), amount: 99999, pay_status: 'pending', part_paid: 0 }
      ].filter(e => e.user_id === uid && (!want || e.user_id === want));
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      return send(res, 200, rows.slice(offset, offset + limit));
    }
    if (url.pathname === '/rest/v1/shoots') {
      const uid = state.tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!uid) return send(res, 401, { message: 'JWT expired' });
      const want = url.searchParams.get('user_id')?.replace('eq.', '');
      const id = url.searchParams.get('id')?.replace('eq.', '');
      let rows = SHOOTS.filter(s => state.leak ? true : s.user_id === uid);   // `leak` imitates a too-broad admin policy
      if (want && !state.leak) rows = rows.filter(s => s.user_id === want);
      if (id) rows = rows.filter(s => s.id === id);
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      return send(res, 200, rows.slice(offset, offset + limit));
    }
    send(res, 404, { message: 'not found' });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, state, day, close: () => new Promise(r => server.close(r)) })));
}

// ---- The test ----
const PORT = 8799, BASE = `https://127.0.0.1:${PORT}`, REDIRECT = 'https://ai.example.com/callback', RESOURCE = 'https://mcp.sakkhi.co.in/mcp';   // MCP clients name the server they want a token for (RFC 8707)
let fake, worker;

const b64u = b => Buffer.from(b).toString('base64url');
// The Worker is started with --local-upstream so it sees the production hostname: token audiences and
// the discovery documents are then checked exactly as they will be on mcp.sakkhi.co.in.
const req = (path, opts = {}) => fetch(BASE + path, { redirect: 'manual', ...opts });
const cookieJar = res => (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
const form = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) [].concat(v).forEach(x => p.append(k, x)); return p; };

before(async () => {
  fake = await startFakeSupabase(54399);
  worker = spawn('npx', ['wrangler', 'dev', '--local', '--config', 'wrangler.e2e.jsonc', '--ip', '127.0.0.1', '--port', String(PORT), '--local-protocol', 'https', '--local-upstream', 'mcp.sakkhi.co.in', '--persist-to', '.e2e-state'], { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('Worker did not start');
});
after(async () => { worker?.kill('SIGTERM'); await fake?.close(); });

// One OAuth connection, the way ChatGPT/Claude do it (dynamic registration + PKCE).
async function register() {
  const r = await req('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test AI', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  assert.equal(r.status, 201, 'registration');
  return (await r.json()).client_id;
}
function authUrl(clientId, scope, verifier) {
  const challenge = b64u(createHash('sha256').update(verifier).digest());
  return '/authorize?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope, state: 'st123', code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE });
}
async function openConsent(clientId, scope, verifier) {
  const page = await req(authUrl(clientId, scope, verifier));
  const html = await page.text();
  return { page, html, cookie: cookieJar(page), handle: /name="handle" value="([^"]+)"/.exec(html)?.[1] };
}
const post = (c, fields, cookie) => req('/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body: form({ handle: c.handle, ...fields }) });
async function tokens(clientId, code, verifier) {
  const r = await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE }) });
  return { status: r.status, body: await r.json() };
}
async function mcp(token, method, params, id = 1) {
  const r = await req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const text = await r.text();
  if (process.env.E2E_DEBUG && r.status >= 400) console.error('MCP', r.status, r.headers.get('www-authenticate'), text.slice(0, 300));
  return { status: r.status, json: text ? JSON.parse(text.startsWith('event:') ? text.split('data: ')[1] : text) : null };
}
const tool = async (token, name, args = {}) => { const r = await mcp(token, 'tools/call', { name, arguments: args }); return JSON.parse(r.json.result.content[0].text); };
const init = token => mcp(token, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });

let full;   // tokens for a connection with every permission

test('server is up and says it signs in with Google', async () => {
  const h = await (await req('/health')).json();
  assert.equal(h.enabled, true); assert.equal(h.signIn, 'google');
});
test('discovery documents are published', async () => {
  const meta = await (await req('/.well-known/oauth-authorization-server')).json();
  assert.ok(meta.authorization_endpoint.endsWith('/authorize')); assert.ok(meta.registration_endpoint);
  const prm = await req('/.well-known/oauth-protected-resource/mcp');
  assert.equal(prm.status, 200);
  const doc = await prm.json();
  assert.equal(doc.resource, 'https://mcp.sakkhi.co.in/mcp');
  assert.deepEqual(doc.authorization_servers, ['https://mcp.sakkhi.co.in']);
});
test('the tool endpoint refuses callers who have not signed in', async () => {
  const r = await req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate') || '', /resource_metadata/);
});

test('consent page: Google sign-in, no password, strict security headers', async () => {
  const clientId = await register();
  const c = await openConsent(clientId, 'shoots:read payments:read summary:read offline_access', randomBytes(32).toString('base64url'));
  assert.equal(c.page.status, 200);
  assert.match(c.html, /accounts\.google\.com\/gsi\/client/);
  assert.doesNotMatch(c.html, /type="password"|name="password"|name="email"/i);
  assert.ok(c.handle && c.cookie, 'handle + browser-binding cookie issued');
  const csp = c.page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'nonce-[^']+' https:\/\/accounts\.google\.com\/gsi\/client/); assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(c.page.headers.get('x-frame-options'), 'DENY');
});

test('sign-in is refused for non-Google, brand-new and invalid logins; the same page can then retry', async () => {
  const clientId = await register(), verifier = randomBytes(32).toString('base64url');
  const c = await openConsent(clientId, 'shoots:read payments:read offline_access', verifier);
  const scopes = ['shoots:read', 'payments:read', 'offline_access'];
  for (const [cred, expect] of [['garbage', /did not accept|Use the Google account/], ['fake-email:user-a', /only supports signing in with Google/], ['fake-google:user-new', /sign in once/], ['', /did not complete/]]) {
    const r = await post(c, { credential: cred, scope: scopes }, c.cookie);
    assert.ok(r.status >= 400 && !r.headers.get('location'), `refused: ${cred}`);
    assert.match(await r.text(), expect);
  }
  assert.ok(!fake.state.calls.some(x => x.includes('grant_type=password')), 'password login is never attempted');
  const ok = await post(c, { credential: 'fake-google:user-a', scope: scopes }, c.cookie);
  assert.equal(ok.status, 302, 'a valid Google login still works on the same page after failures');
});

test('a sign-in without the browser cookie cannot be completed (consent cannot be hijacked)', async () => {
  const clientId = await register();
  const c = await openConsent(clientId, 'shoots:read offline_access', randomBytes(32).toString('base64url'));
  const r = await post(c, { credential: 'fake-google:user-a', scope: ['shoots:read', 'offline_access'] }, '');
  assert.ok(!(r.headers.get('location') || '').startsWith(REDIRECT), 'no authorization code handed out');
});

test('Cancel sends the app back with access_denied', async () => {
  const clientId = await register();
  const c = await openConsent(clientId, 'shoots:read offline_access', randomBytes(32).toString('base64url'));
  const r = await post(c, { deny: '1' }, c.cookie);
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /error=access_denied/);
});

test('full connection with every permission: sign in with Google, get tokens, use the tools', async () => {
  const clientId = await register(), verifier = randomBytes(32).toString('base64url');
  const c = await openConsent(clientId, 'shoots:read payments:read summary:read offline_access', verifier);
  const done = await post(c, { credential: 'fake-google:user-a', scope: ['shoots:read', 'payments:read', 'summary:read', 'offline_access'] }, c.cookie);
  assert.equal(done.status, 302);
  const loc = new URL(done.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, REDIRECT); assert.equal(loc.searchParams.get('state'), 'st123');
  const t = await tokens(clientId, loc.searchParams.get('code'), verifier);
  assert.equal(t.status, 200); assert.ok(t.body.access_token && t.body.refresh_token);
  full = { clientId, ...t.body };

  assert.equal((await init(full.access_token)).status, 200);
  const names = (await mcp(full.access_token, 'tools/list', {})).json.result.tools.map(x => x.name).sort();
  for(const name of ['get_company_portal_links','get_connection_permissions','get_editing_job_details','get_editing_jobs','get_financial_overview','get_monthly_finances','get_next_shoot','get_pending_payments','get_shoot_details','get_shoots','get_year_summary'])assert.ok(names.includes(name), 'missing '+name);
  const listed = (await mcp(full.access_token, 'tools/list', {})).json.result.tools;
  assert.ok(listed.every(x => x.annotations?.readOnlyHint === true), 'every tool is marked read-only');

  const all = await tool(full.access_token, 'get_shoots');
  assert.equal(all.total, 4, 'only the signed-in user\'s shoots');
  assert.ok(!JSON.stringify(all).includes('secret shoot'));
  const due = await tool(full.access_token, 'get_pending_payments');
  assert.equal(due.total_pending, 50000 + 30000, 'due = completed shoots only (same as the dashboard)');
  assert.equal(due.count, 2);
  assert.equal(due.upcoming_balance_not_yet_due, 60000, 'upcoming balance reported separately');
  const next = await tool(full.access_token, 'get_next_shoot');
  assert.equal(next.shoot.id, 's3');
  const year = await tool(full.access_token, 'get_year_summary', { year: Number(fake.day(-10).slice(0, 4)) });
  assert.ok(year.shoot_count >= 1 && year.pending <= 80000);
});

test("another user's shoot can never be read, even if the database were too permissive", async () => {
  assert.equal((await tool(full.access_token, 'get_shoot_details', { id: 'sb' })).shoot, null);
  fake.state.leak = true;                                           // pretend an admin policy returns everyone's rows
  const r = await mcp(full.access_token, 'tools/call', { name: 'get_shoots', arguments: {} });
  assert.equal(r.json.result.isError, true); assert.match(r.json.result.content[0].text, /Ownership validation failed/);
  assert.ok(!JSON.stringify(r.json).includes('secret shoot'));
  fake.state.leak = false;
});

test('refreshing keeps working and rotates the Sakkhi session', async () => {
  const r = await req('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: full.refresh_token, client_id: full.clientId, resource: RESOURCE }) });
  assert.equal(r.status, 200);
  const n = await r.json();
  assert.ok(n.access_token && n.access_token !== full.access_token);
  assert.equal((await tool(n.access_token, 'get_shoots')).total, 4);
  assert.ok(fake.state.calls.some(x => x.includes('grant_type=refresh_token')));
});

test('a connection granted only "shoots" sees no money and gets no payment tools', async () => {
  const clientId = await register(), verifier = randomBytes(32).toString('base64url');
  const c = await openConsent(clientId, 'shoots:read payments:read summary:read offline_access', verifier);
  const done = await post(c, { credential: 'fake-google:user-a', scope: ['shoots:read', 'offline_access'] }, c.cookie);   // user untick the money permissions
  const code = new URL(done.headers.get('location')).searchParams.get('code');
  const t = await tokens(clientId, code, verifier);
  await init(t.body.access_token);
  const names = (await mcp(t.body.access_token, 'tools/list', {})).json.result.tools.map(x => x.name).sort();
  for(const name of ['get_company_portal_links','get_connection_permissions','get_editing_job_details','get_editing_jobs','get_next_shoot','get_shoot_details','get_shoots'])assert.ok(names.includes(name), 'missing '+name);for(const name of ['get_financial_overview','get_monthly_finances','get_pending_payments','get_year_summary'])assert.ok(!names.includes(name), 'unauthorized payment tool '+name);
  const s = await tool(t.body.access_token, 'get_shoots');
  for (const shoot of s.shoots) for (const f of ['amount', 'paid', 'pending', 'payment_status']) assert.equal(Object.hasOwn(shoot, f), false, `${f} hidden`);
});

test('an authorization code can only be used once; replaying it revokes what it produced', async () => {
  const clientId = await register(), verifier = randomBytes(32).toString('base64url');
  const c = await openConsent(clientId, 'shoots:read offline_access', verifier);
  const done = await post(c, { credential: 'fake-google:user-a', scope: ['shoots:read', 'offline_access'] }, c.cookie);
  const code = new URL(done.headers.get('location')).searchParams.get('code');
  const first = await tokens(clientId, code, verifier);
  assert.equal(first.status, 200);
  assert.equal((await tool(first.body.access_token, 'get_shoots')).total, 4);
  assert.equal((await tokens(clientId, code, verifier)).status, 400, 'second use of the code is refused');
  const after = await mcp(first.body.access_token, 'tools/call', { name: 'get_shoots', arguments: {} });
  assert.equal(after.status, 401, 'tokens from a replayed code are revoked (OAuth security best practice)');
});

test('a wrong PKCE verifier cannot redeem a code', async () => {
  const clientId = await register(), verifier = randomBytes(32).toString('base64url');
  const c = await openConsent(clientId, 'shoots:read offline_access', verifier);
  const done = await post(c, { credential: 'fake-google:user-a', scope: ['shoots:read', 'offline_access'] }, c.cookie);
  const code = new URL(done.headers.get('location')).searchParams.get('code');
  assert.equal((await tokens(clientId, code, randomBytes(32).toString('base64url'))).status, 400);
});
