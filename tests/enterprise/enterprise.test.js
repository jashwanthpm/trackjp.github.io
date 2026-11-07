// Runs the real Enterprise pages in a simulated browser against an in-memory fake Supabase.
//   cd tests/enterprise && npm ci && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { makeDb } = require('./fake-rest.js');

const ROOT = path.resolve(__dirname, '../..');
const ENT_JS = fs.readFileSync(path.join(ROOT, 'enterprise/assets/ent.js'), 'utf8');
const opened = [];   // every simulated page, closed at the end so their timers cannot keep the process alive
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); for (;;) { try { const v = fn(); if (v) return v; } catch (e) {} if (Date.now() - t > ms) throw new Error('timed out waiting: ' + fn); await wait(15); } };
const iso = d => new Date(Date.now() + d * 864e5).toISOString();
const day = d => iso(d).slice(0, 10);

function seed() {
  return {
    enterprise_workspaces: [{ id: 'w1', name: 'Acme Weddings', slug: null, phone: '+91 98765 43210', email: null, address: null, gstin: null, logo_url: null, currency: 'INR', invoice_prefix: 'INV', invoice_terms: null, bank_details: {} }],
    enterprise_workspace_members: [
      { id: 'm1', workspace_id: 'w1', user_id: 'u-owner', role: 'owner', status: 'active', display_name: 'Olivia Owner', email: 'o@acme.com', created_at: iso(-90) },
      { id: 'm2', workspace_id: 'w1', user_id: 'u-shooter', role: 'shooter', status: 'active', display_name: 'Sam Shooter', email: 's@acme.com', created_at: iso(-80) },
      { id: 'm3', workspace_id: 'w1', user_id: 'u-fin', role: 'finance', status: 'active', display_name: 'Fin Ance', email: 'f@acme.com', created_at: iso(-70) }],
    enterprise_leads: [
      { id: 'l1', workspace_id: 'w1', contact_name: 'Priya Nair', contact_phone: '9876543210', contact_email: 'priya@x.com', event_type: 'Wedding', event_date: day(30), location: 'Kochi', budget: 150000, status: 'new', source: 'Enquiry form', created_at: iso(-1 / 24), follow_up_at: null, priority: 'normal', message: 'Need 2 photographers' },
      { id: 'l2', workspace_id: 'w1', contact_name: 'Rahul Verma', contact_phone: '9000000002', contact_email: null, event_type: 'Corporate event', event_date: null, location: null, budget: 80000, status: 'contacted', source: 'Phone call', created_at: iso(-2), follow_up_at: iso(-2 / 24), priority: 'high' },
      { id: 'l3', workspace_id: 'w1', contact_name: 'Meera Iyer', contact_phone: null, contact_email: 'meera@x.com', event_type: 'Birthday', event_date: null, location: null, budget: 40000, status: 'quoted', source: 'Instagram', created_at: iso(-5), follow_up_at: null, priority: 'normal' },
      { id: 'l4', workspace_id: 'w1', contact_name: 'Arjun Das', contact_phone: '9000000004', contact_email: 'arjun@x.com', event_type: 'Wedding', event_date: day(20), location: 'Goa', budget: 200000, status: 'won', source: 'Referral', created_at: new Date().toISOString(), follow_up_at: null, client_id: null, priority: 'normal' },
      { id: 'l5', workspace_id: 'w1', contact_name: 'Old Lead', contact_phone: null, contact_email: null, event_type: null, event_date: null, location: null, budget: 10000, status: 'lost', source: 'Website', created_at: iso(-40), follow_up_at: null, lost_reason: 'No response', priority: 'normal' }],
    enterprise_clients: [{ id: 'c1', workspace_id: 'w1', name: 'Priya Nair Studio', email: 'priya@studio.com', phone: null }],
    enterprise_invoices: [
      { id: 'i1', workspace_id: 'w1', invoice_number: 'INV-001', status: 'issued', total: 50000, amount_paid: 20000, due_date: day(-10) },
      { id: 'i2', workspace_id: 'w1', invoice_number: 'INV-002', status: 'paid', total: 30000, amount_paid: 30000, due_date: day(-30) },
      { id: 'i3', workspace_id: 'w1', invoice_number: 'INV-003', status: 'part_paid', total: 20000, amount_paid: 5000, due_date: day(5) }],
    enterprise_notifications: [
      { id: 'n1', workspace_id: 'w1', kind: 'lead', title: 'New enquiry from Priya Nair', body: 'Wedding', link: 'leads.html?id=l1', read_by: [], created_at: iso(-1 / 24) },
      { id: 'n2', workspace_id: 'w1', kind: 'lead', title: 'New enquiry from Kiran', body: 'Birthday', link: 'leads.html?id=l3', read_by: [], created_at: iso(-3 / 24) },
      { id: 'n3', workspace_id: 'w1', kind: 'lead', title: 'Old news', body: '', link: null, read_by: ['u-owner'], created_at: iso(-9) }],
    enterprise_inquiry_forms: []
  };
}

async function open(file, { db, url, user = 'u-owner', token = 'good', extra, search = '' } = {}) {
  db = db || makeDb(seed());
  db.tokenOk.add(token); db.userOf = Object.assign(db.userOf || {}, { [token]: user });
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8').replace('<script src="assets/ent.js"></script>', '<script>' + ENT_JS + '</script>');
  const errors = []; const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message.slice(0, 160)); });
  const blobs = [];
  const dom = new JSDOM(html, { url: url || ('https://sakkhi.co.in/' + file + search), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.tailwind = {}; w.scrollTo = () => {}; w.fetch = db.fetch;
      w.localStorage.setItem('currentUser', JSON.stringify({ id: user, name: user === 'u-owner' ? 'Olivia Owner' : 'Someone', email: 'x@acme.com', token, refreshToken: 'r1' }));
      w.URL.createObjectURL = b => { blobs.push(b); return 'blob:x'; }; w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { w.__copied = t; } } });
      if (extra) extra(w);
    } });
  opened.push(dom);
  const w = dom.window, d = w.document;
  const $ = id => d.getElementById(id);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { dom, w, d, $, click, type, db, errors, blobs };
}
test.after(() => opened.forEach(d => { try { d.window.close(); } catch (e) {} }));
const toasts = p => [...p.d.querySelectorAll('.e-toast')].map(t => t.textContent);

/* ======================= ent.js ======================= */
test('session: an expired token is refreshed once and the request retried', async () => {
  const p = await open('enterprise/dashboard.html', { token: 'stale' });
  p.db.tokenOk.delete('stale');                                   // the token the page starts with has expired
  const rows = await p.w.ENT.sb('enterprise_clients?workspace_id=eq.w1&select=id');
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(p.w.localStorage.getItem('currentUser')).token, 'fresh', 'new token saved for the Solo app too');
  assert.ok(p.db.calls.some(c => c.path.startsWith('../auth') || c.path.includes('auth/v1/token')), 'called the refresh endpoint');
});

/* ======================= Shell ======================= */
test('shell: shows who you are, role-aware menu, and loads the overview', async () => {
  const p = await open('enterprise/index.html');
  await until(() => p.$('me-role').textContent === 'owner');
  assert.equal(p.$('me-name').textContent, 'Olivia Owner');
  assert.equal(p.$('me-ws').textContent, 'Acme Weddings');
  assert.match(p.$('view').getAttribute('src'), /dashboard\.html$/);
  assert.ok([...p.d.querySelectorAll('[data-perm]')].every(e => e.style.display !== 'none'), 'owner sees every menu item');
  assert.equal(p.$('me-solo').getAttribute('href'), '/app/', 'Switch to Solo goes to the Solo app');
  assert.equal(p.$('side-solo').getAttribute('href'), '/app/');
  assert.deepEqual(p.errors, []);
});
test('shell: a shooter only sees what their role allows', async () => {
  const p = await open('enterprise/index.html', { user: 'u-shooter', token: 'tok-s' });
  await until(() => p.$('me-role').textContent === 'shooter');
  const hidden = [...p.d.querySelectorAll('[data-perm]')].filter(e => e.style.display === 'none').map(e => e.getAttribute('href'));
  for (const h of ['leads.html', 'forms.html', 'invoices.html', 'team.html', 'dashboard.html']) assert.ok(hidden.includes(h), h + ' hidden');
  assert.match(p.$('view').getAttribute('src'), /calendar\.html$/, 'lands on the calendar, not the money dashboard');
  p.w.ENT_SHELL.go('leads.html');
  assert.match(p.$('view').getAttribute('src'), /dashboard\.html$|calendar\.html$/, 'typing a forbidden page in the URL does not open it');
});
test('shell: deep links only open pages from the allow-list', async () => {
  const p = await open('enterprise/index.html', { url: 'https://sakkhi.co.in/enterprise/#leads.html%3Fid%3Dl2' });
  await until(() => p.$('me-role').textContent === 'owner');
  assert.match(p.$('view').getAttribute('src'), /leads\.html\?id=l2$/);
  p.w.ENT_SHELL.go('https://evil.example/x.html'); assert.match(p.$('view').getAttribute('src'), /dashboard\.html$/);
  p.w.ENT_SHELL.go('javascript:alert(1)'); assert.match(p.$('view').getAttribute('src'), /dashboard\.html$/);
});
test('shell: notifications combine saved alerts with live overdue invoices and follow-ups', async () => {
  const p = await open('enterprise/index.html');
  await until(() => p.$('bell-dot').textContent === '4');
  assert.equal(p.$('nav-leads-pill').textContent, '2', 'Leads menu badge = unread new enquiries');
  p.click(p.$('bell'));
  const text = p.$('bell-list').textContent;
  assert.match(text, /New enquiry from Priya Nair/); assert.match(text, /Invoice INV-001 is overdue/); assert.match(text, /Follow up with Rahul Verma/);
  assert.doesNotMatch(text, /INV-003/, 'a not-yet-due invoice is not an alert');
  // opening one marks only it read and goes to the lead
  const first = [...p.$('bell-list').querySelectorAll('button')].find(b => /Priya Nair/.test(b.textContent));
  p.click(first);
  await until(() => p.$('bell-dot').textContent === '3');
  assert.match(p.$('view').getAttribute('src'), /leads\.html\?id=l1$/);
  assert.ok(p.db.calls.some(c => c.path === 'rpc/enterprise_mark_notifications_read' && c.body.p_ids[0] === 'n1'));
  p.click(p.$('mark-all'));
  await until(() => p.$('bell-dot').textContent === '2', 2000);     // only the two live alerts remain
  assert.deepEqual(p.db.tables.enterprise_notifications.map(n => n.read_by.includes('u-owner')), [true, true, true]);
});
test('shell: global search finds leads, clients and invoices, and opens them', async () => {
  const p = await open('enterprise/index.html');
  await until(() => p.$('me-role').textContent === 'owner');
  p.type(p.$('gs'), 'priya');
  await until(() => p.$('gs-pop').classList.contains('open') && /Priya Nair/.test(p.$('gs-pop').textContent), 2500);
  assert.match(p.$('gs-pop').textContent, /Leads/); assert.match(p.$('gs-pop').textContent, /Clients/); assert.match(p.$('gs-pop').textContent, /Priya Nair Studio/);
  p.click(p.$('gs-pop').querySelector('[data-go^="leads.html?id=l1"]'));
  assert.match(p.$('view').getAttribute('src'), /leads\.html\?id=l1$/);
  assert.equal(p.$('gs').value, '');
  p.type(p.$('gs'), 'INV-00'); await until(() => /INV-001/.test(p.$('gs-pop').textContent), 2500);
  p.type(p.$('gs'), 'zzzz'); await until(() => /No matches/.test(p.$('gs-pop').textContent), 2500);
  p.type(p.$('gs'), '),(x'); await wait(400);   // characters that could break the filter are neutralised, no crash
  assert.deepEqual(p.errors, []);
});
test('shell: sign out wipes the session but keeps the device id', async () => {
  const p = await open('enterprise/index.html', { extra: w => w.localStorage.setItem('current_device_id', 'dev-9') });
  await until(() => p.$('me-role').textContent === 'owner');
  p.click(p.$('signout'));
  assert.equal(p.w.localStorage.getItem('currentUser'), null); assert.equal(p.w.localStorage.getItem('current_device_id'), 'dev-9');
});
test('shell: if the database update was not run yet, say so instead of showing a blank page', async () => {
  const db = makeDb(seed()); db.missingColumns = true;
  const p = await open('enterprise/index.html', { db });
  await until(() => p.$('me-ws').textContent === 'Acme Weddings');
  assert.ok(!p.$('mig').classList.contains('hidden'), 'banner shown'); assert.match(p.$('mig').textContent, /Apply Enterprise database update/);
  const ok = await open('enterprise/index.html'); await until(() => ok.$('me-role').textContent === 'owner'); assert.ok(ok.$('mig').classList.contains('hidden'), 'no banner when everything is up to date');
});
test('shell: a new company is asked to set up its workspace first', async () => {
  const p = await open('enterprise/index.html', { user: 'u-new', token: 'tok-new' });
  await until(() => p.$('onb').classList.contains('open'));
  p.click(p.$('onb-go')); assert.match(p.$('onb-err').textContent, /company name/);
  p.type(p.$('onb-name'), 'Fresh Frames'); p.click(p.$('onb-go'));
  await until(() => !p.$('onb').classList.contains('open') && p.$('me-ws').textContent === 'Fresh Frames', 2500);
  assert.equal(p.$('me-role').textContent, 'owner');
});

/* ======================= Overview ======================= */
test('overview: figures are correct and lists are filled', async () => {
  const p = await open('enterprise/dashboard.html');
  await until(() => /Outstanding/.test(p.$('kpis').textContent));
  const t = p.$('kpis').textContent.replace(/\s+/g, ' ');
  assert.match(t, /New enquiries\s*4/); assert.match(t, /₹2,70,000/); assert.match(t, /Won this month\s*1/); assert.match(t, /₹2,00,000 in bookings/); assert.match(t, /₹45,000/); assert.match(t, /2 unpaid invoices/);
  assert.match(p.$('recent').textContent, /Priya Nair/); assert.match(p.$('followups').textContent, /Rahul Verma/);
  assert.match(p.$('events').textContent, /Arjun Das/); assert.match(p.$('overdue').textContent, /INV-001/); assert.doesNotMatch(p.$('overdue').textContent, /INV-003/);
  assert.match(p.$('overdue').textContent, /₹30,000/, 'overdue amount is what is still owed, not the invoice total');
  assert.match(p.$('setup').textContent, /Share your enquiry form/, 'checklist shows the steps still to do');
  assert.deepEqual(p.errors, []);
});
test('overview: an empty company gets guidance, not blanks', async () => {
  const db = makeDb(seed()); db.tables.enterprise_leads = []; db.tables.enterprise_invoices = [];
  const p = await open('enterprise/dashboard.html', { db });
  await until(() => /Outstanding/.test(p.$('kpis').textContent));
  assert.match(p.$('recent').textContent, /No enquiries yet/); assert.match(p.$('kpis').textContent, /₹0/);
});

/* ======================= Leads ======================= */
const cardsIn = (p, col) => [...p.d.querySelectorAll('.col[data-col="' + col + '"] .lcard')].map(c => c.textContent);
test('leads: board groups leads by stage', async () => {
  const p = await open('enterprise/leads.html');
  await until(() => p.d.querySelector('.board'));
  assert.equal(p.d.querySelectorAll('.col').length, 6);
  assert.match(cardsIn(p, 'new')[0], /Priya Nair/); assert.match(cardsIn(p, 'contacted')[0], /follow up/, 'overdue follow-up is flagged'); assert.match(cardsIn(p, 'won')[0], /Arjun Das/); assert.match(cardsIn(p, 'lost')[0], /Old Lead/);
  assert.match(p.$('sub').textContent, /5 total · 3 active/);
  assert.deepEqual(p.errors, []);
});
test('leads: search, source filter, list view and stage chips', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.type(p.$('q'), 'rahul'); await until(() => p.d.querySelectorAll('.lcard').length === 1);
  p.type(p.$('q'), ''); await until(() => p.d.querySelectorAll('.lcard').length === 5);
  p.type(p.$('src'), 'Instagram'); await until(() => p.d.querySelectorAll('.lcard').length === 1); p.type(p.$('src'), '');
  p.click(p.$('v-list')); await until(() => p.d.querySelector('.e-table'));
  assert.equal(p.d.querySelectorAll('[data-row]').length, 5);
  p.click(p.d.querySelector('#chips [data-st="won"]')); await until(() => p.d.querySelectorAll('[data-row]').length === 1);
  assert.match(p.d.querySelector('[data-row]').textContent, /Arjun Das/);
});
test('leads: moving a lead changes its stage and saves it; a failure rolls it back', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.type(p.d.querySelector('[data-mv="l3"]'), 'won');
  await until(() => cardsIn(p, 'won').some(c => /Meera/.test(c)));
  const patch = p.db.calls.find(c => c.method === 'PATCH' && c.path.includes('id=eq.l3'));
  assert.equal(patch.body.status, 'won'); assert.equal(p.db.tables.enterprise_leads.find(l => l.id === 'l3').status, 'won');
  p.db.refreshFail = true; p.db.tokenOk.clear();                     // the session has expired and cannot be renewed
  p.type(p.d.querySelector('[data-mv="l1"]'), 'contacted');
  await until(() => toasts(p).some(t => /Could not move/.test(t)), 3000);
  assert.ok(cardsIn(p, 'new').some(c => /Priya/.test(c)), 'card went back where it was');
});
test('leads: marking lost asks for a reason and stores it', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.type(p.d.querySelector('[data-mv="l2"]'), 'lost');
  await until(() => p.$('lostm').classList.contains('open'));
  p.type(p.$('lost-r'), 'Budget too high'); p.click(p.$('lost-ok'));
  await until(() => p.db.tables.enterprise_leads.find(l => l.id === 'l2').status === 'lost');
  assert.equal(p.db.tables.enterprise_leads.find(l => l.id === 'l2').lost_reason, 'Budget too high');
});
test('leads: adding a lead validates, saves and appears on the board', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.click(p.$('add')); await until(() => p.$('dr').classList.contains('open'));
  const before = p.db.calls.length;
  p.click(p.$('d-save')); assert.ok(toasts(p).some(t => /enter a name/.test(t))); assert.equal(p.db.calls.length, before, 'nothing sent without a name');
  p.type(p.$('f-name'), 'Test Client'); p.type(p.$('f-email'), 'nope'); p.click(p.$('d-save')); assert.ok(toasts(p).some(t => /email address/.test(t)));
  p.type(p.$('f-email'), 'Test@Client.com'); p.type(p.$('f-phone'), '99999 11111'); p.type(p.$('f-type'), 'Wedding'); p.type(p.$('f-budget'), '25000'); p.type(p.$('f-source'), 'Referral');
  p.click(p.$('d-save'));
  await until(() => p.db.tables.enterprise_leads.some(l => l.contact_name === 'Test Client'));
  const row = p.db.tables.enterprise_leads.find(l => l.contact_name === 'Test Client');
  assert.equal(row.workspace_id, 'w1'); assert.equal(row.created_by, 'u-owner'); assert.equal(row.status, 'new'); assert.equal(row.budget, 25000); assert.equal(row.contact_email, 'test@client.com');
  await until(() => cardsIn(p, 'new').some(c => /Test Client/.test(c)));
  assert.ok(!p.$('dr').classList.contains('open'), 'drawer closes after saving');
});
test('leads: editing saves only to that lead', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.click(p.d.querySelector('.lcard[data-id="l1"]')); await until(() => p.$('dr').classList.contains('open'));
  assert.equal(p.$('f-name').value, 'Priya Nair'); assert.match(p.$('dr-body').innerHTML, /wa\.me\/919876543210/, 'WhatsApp link adds the country code'); assert.match(p.$('dr-body').innerHTML, /tel:9876543210/);
  p.type(p.$('f-phone'), '90000 99999'); p.type(p.$('f-fu'), '2030-01-02T10:30'); p.click(p.$('d-save'));
  await until(() => p.db.tables.enterprise_leads.find(l => l.id === 'l1').contact_phone === '90000 99999');
  assert.ok(p.db.calls.find(c => c.method === 'PATCH' && c.path.includes('id=eq.l1')));
  assert.equal(p.db.tables.enterprise_leads.find(l => l.id === 'l2').contact_phone, '9000000002', 'other leads untouched');
  assert.match(p.db.tables.enterprise_leads.find(l => l.id === 'l1').follow_up_at, /^2030-01-02T/);
});
test('leads: making a lead a client creates the client and links it', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.click(p.d.querySelector('.lcard[data-id="l4"]')); await until(() => p.$('d-conv'));
  p.click(p.$('d-conv'));
  await until(() => p.db.tables.enterprise_clients.some(c => c.name === 'Arjun Das'));
  const client = p.db.tables.enterprise_clients.find(c => c.name === 'Arjun Das');
  assert.equal(client.email, 'arjun@x.com'); assert.equal(client.created_by, 'u-owner');
  await until(() => p.db.tables.enterprise_leads.find(l => l.id === 'l4').client_id === client.id);
});
test('leads: delete asks first, and only managers can do it', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.click(p.d.querySelector('.lcard[data-id="l5"]')); await until(() => p.$('d-del'));
  p.click(p.$('d-del')); await until(() => p.d.querySelector('.e-modal.open [data-r="0"]'));
  p.click(p.d.querySelector('.e-modal.open [data-r="0"]')); await wait(60); assert.ok(p.db.tables.enterprise_leads.some(l => l.id === 'l5'), 'cancel keeps it');
  p.click(p.$('d-del')); await until(() => p.d.querySelector('.e-modal.open [data-r="1"]')); p.click(p.d.querySelector('.e-modal.open [data-r="1"]'));
  await until(() => !p.db.tables.enterprise_leads.some(l => l.id === 'l5'));
  const f = await open('enterprise/leads.html', { user: 'u-fin', token: 'tok-f' }); await until(() => f.d.querySelector('.board'));
  f.click(f.d.querySelector('.lcard[data-id="l1"]')); await until(() => f.$('d-save')); assert.equal(f.$('d-del'), null, 'finance sees no delete button');
});
test('leads: deep links open the right lead or a blank form', async () => {
  const a = await open('enterprise/leads.html', { search: '?id=l2' }); await until(() => a.$('dr').classList.contains('open')); assert.equal(a.$('f-name').value, 'Rahul Verma');
  const b = await open('enterprise/leads.html', { search: '?new=1' }); await until(() => b.$('dr').classList.contains('open')); assert.equal(b.$('f-name').value, ''); assert.equal(b.$('dr-title').textContent, 'New lead');
  const c = await open('enterprise/leads.html', { search: '?id=nope' }); await until(() => toasts(c).some(t => /no longer exists/.test(t)));
});
test('leads: export downloads the visible leads as CSV', async () => {
  const p = await open('enterprise/leads.html'); await until(() => p.d.querySelector('.board'));
  p.type(p.$('q'), 'priya'); await until(() => p.d.querySelectorAll('.lcard').length === 1);
  p.click(p.$('export')); await until(() => p.blobs.length);
  const read = (m) => new Promise(r => { const fr = new p.w.FileReader(); fr.onload = () => r(fr.result); fr[m](p.blobs[0]); });
  const csv = await read('readAsText'), bytes = new Uint8Array(await read('readAsArrayBuffer'));
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], 'starts with a byte-order mark so Excel reads rupee signs and accents correctly');
  assert.match(csv, /^Name,Phone,Email/); assert.match(csv, /Priya Nair/); assert.doesNotMatch(csv, /Rahul/);
});
test('leads: roles without access are told so', async () => {
  const p = await open('enterprise/leads.html', { user: 'u-shooter', token: 'tok-s' });
  await until(() => /does not have access/.test(p.d.body.textContent));
});
test('leads: an HTML-looking name is shown as text, never run', async () => {
  const db = makeDb(seed()); db.tables.enterprise_leads[0].contact_name = '<img src=x onerror=alert(1)>';
  const p = await open('enterprise/leads.html', { db }); await until(() => p.d.querySelector('.board'));
  assert.equal(p.d.querySelectorAll('img[src="x"]').length, 0); assert.match(p.d.querySelector('.lcard[data-id="l1"]').textContent, /<img src=x/);
});

/* ======================= Enquiry forms (admin) ======================= */
test('forms: first visit creates the form; settings, link, embed and reset work', async () => {
  const p = await open('enterprise/forms.html');
  await until(() => p.$('lnk')); assert.equal(p.db.tables.enterprise_inquiry_forms.length, 1);
  assert.match(p.$('lnk').value, /\/enquiry\/\?f=a1b2c3d4e5f6a1b2c3$/); assert.match(p.$('emb').value, /<iframe src=".*enquiry\/\?f=/);
  p.click(p.$('copy')); await until(() => p.w.__copied === p.$('lnk').value);
  p.type(p.$('f-title'), 'Book your date'); p.type(p.$('f-types'), 'Wedding\n\nBirthday\n  Engagement  '); p.$('f-budget').checked = false; p.$('f-active').checked = false; p.click(p.$('save'));
  await until(() => p.db.tables.enterprise_inquiry_forms[0].title === 'Book your date');
  const f = p.db.tables.enterprise_inquiry_forms[0];
  assert.deepEqual(f.event_types, ['Wedding', 'Birthday', 'Engagement']); assert.equal(f.ask_budget, false); assert.equal(f.is_active, false);
  p.click(p.$('reset')); await until(() => p.d.querySelector('.e-modal.open [data-r="1"]')); p.click(p.d.querySelector('.e-modal.open [data-r="1"]'));
  await until(() => f.token !== 'a1b2c3d4e5f6a1b2c3'); assert.match(f.token, /^[a-f0-9]{18}$/);
  assert.match(p.$('lnk').value, new RegExp(f.token));
});
test('forms: only managers can open it', async () => {
  const p = await open('enterprise/forms.html', { user: 'u-fin', token: 'tok-f' });
  await until(() => /Only owners, admins and managers/.test(p.d.body.textContent));
  assert.equal(p.db.tables.enterprise_inquiry_forms.length, 0, 'no form is created for them');
});

/* ======================= Public enquiry page ======================= */
const formRow = () => ({ id: 'f1', workspace_id: 'w1', token: 'a1b2c3d4e5f6a1b2c3', is_active: true, title: 'Tell us about your event', intro: 'Share a few details.', event_types: ['Wedding', 'Birthday'], ask_date: true, ask_location: true, ask_budget: true, success_message: 'Thanks, we will call you!' });
async function enquiry(over, search) {
  const db = makeDb(seed()); db.tables.enterprise_inquiry_forms = [Object.assign(formRow(), over || {})];
  const p = await open('enquiry/index.html', { db, search: search === undefined ? '?f=a1b2c3d4e5f6a1b2c3' : search, extra: w => w.localStorage.clear() });
  return p;
}
test('enquiry page: shows the studio and form; sends an enquiry; thanks the visitor', async () => {
  const p = await enquiry(); await until(() => !p.$('form').classList.contains('hidden'));
  assert.equal(p.$('studio').textContent, 'Acme Weddings'); assert.equal(p.$('title').textContent, 'Tell us about your event'); assert.equal(p.$('types').children.length, 2);
  assert.ok(p.$('date').min >= '2024-01-01', 'cannot pick a past date');
  p.click(p.$('send')); assert.match(p.$('err').textContent, /enter your name/);
  p.type(p.$('name'), 'Anita Rao'); p.click(p.$('send')); assert.match(p.$('err').textContent, /phone number or an email/);
  p.type(p.$('phone'), '123'); p.click(p.$('send')); assert.match(p.$('err').textContent, /too short/);
  p.type(p.$('phone'), '98765 43210'); p.type(p.$('email'), 'bad'); p.click(p.$('send')); assert.match(p.$('err').textContent, /email address/); p.type(p.$('email'), '');
  p.click(p.$('types').children[0]); assert.equal(p.$('types').children[0].getAttribute('aria-checked'), 'true');
  p.type(p.$('loc'), 'Kochi'); p.type(p.$('budget'), '120000'); p.type(p.$('msg'), 'Two days');
  p.click(p.$('send'));
  await until(() => !p.$('done').classList.contains('hidden'));
  assert.equal(p.$('ok').textContent, 'Thanks, we will call you!');
  const lead = p.db.tables.enterprise_leads.find(l => l.contact_name === 'Anita Rao');
  assert.equal(lead.event_type, 'Wedding'); assert.equal(lead.budget, 120000); assert.equal(lead.location, 'Kochi');
  assert.match(p.$('wa').href, /^https:\/\/wa\.me\/919876543210\?text=/, 'thank-you page links to the studio on WhatsApp');
  assert.deepEqual(p.errors, []);
});
test('enquiry page: bots (filled hidden field) get no lead; a closed or wrong link shows a clear page', async () => {
  const p = await enquiry(); await until(() => !p.$('form').classList.contains('hidden'));
  p.type(p.$('name'), 'Bot'); p.type(p.$('email'), 'bot@spam.com'); p.type(p.$('website'), 'http://spam'); p.click(p.$('send'));
  await until(() => !p.$('done').classList.contains('hidden')); assert.equal(p.db.tables.enterprise_leads.filter(l => l.contact_name === 'Bot').length, 0);
  for (const [over, search] of [[{ is_active: false }], [{}, '?f=ffffffffffffffffff'], [{}, '?f=../../etc'], [{}, '']]) {
    const q = await enquiry(over, search); await until(() => !q.$('gone').classList.contains('hidden')); assert.ok(q.$('form').classList.contains('hidden'));
  }
});
test('enquiry page: optional fields can be switched off and a server error is shown kindly', async () => {
  const p = await enquiry({ ask_date: false, ask_location: false, ask_budget: false }); await until(() => !p.$('form').classList.contains('hidden'));
  assert.equal(p.$('r-date-loc').style.display, 'none'); assert.equal(p.$('w-budget').style.display, 'none');
  p.db.tables.enterprise_inquiry_forms[0].is_active = false;       // paused after the page loaded
  p.type(p.$('name'), 'Late Visitor'); p.type(p.$('email'), 'late@x.com'); p.click(p.$('send'));
  await until(() => /not accepting enquiries/.test(p.$('err').textContent)); assert.ok(!p.$('send').disabled, 'can try again');
});
