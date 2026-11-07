// A small in-memory stand-in for Supabase (PostgREST + the few RPCs the Enterprise pages use).
// It understands exactly the filters the pages send: eq, neq, lt, lte, gte, in, not.in, ilike, or=(...), order, limit.
function makeDb(seed) {
  const db = { tables: JSON.parse(JSON.stringify(seed)), calls: [], tokenOk: new Set(['good']), refreshTo: null, uid: 0 };
  const id = () => 'id-' + (++db.uid);
  const cmp = (a, b) => (a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);
  function match(row, key, spec) {
    const v = row[key]; const [op, ...rest] = spec.split('.'); const arg = rest.join('.');
    if (op === 'eq') return String(v) === arg;
    if (op === 'neq') return String(v) !== arg;
    if (op === 'lt') return v != null && v < arg;
    if (op === 'lte') return v != null && v <= arg;
    if (op === 'gte') return v != null && v >= arg;
    if (op === 'ilike') return v != null && new RegExp('^' + decodeURIComponent(arg).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(String(v));
    if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (op === 'not') return !match(row, key, arg);
    throw new Error('fake-rest: unsupported filter ' + key + '=' + spec);
  }
  function filterRows(rows, params) {
    let out = rows;
    for (const [k, spec] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k === 'or') {
        const parts = spec.replace(/^\(|\)$/g, '').split(/,(?=[a-z_]+\.)/);
        out = out.filter(r => parts.some(p => { const i = p.indexOf('.'); return match(r, p.slice(0, i), p.slice(i + 1)); }));
      } else out = out.filter(r => match(r, k, spec));
    }
    const ord = params.find(([k]) => k === 'order'); if (ord) { const [col, dir] = ord[1].split('.'); out = [...out].sort((a, b) => cmp(a[col], b[col]) * (dir === 'desc' ? -1 : 1)); }
    const lim = params.find(([k]) => k === 'limit'); if (lim) out = out.slice(0, +lim[1]);
    return out;
  }
  const rpcs = {
    enterprise_mark_notifications_read: (a, who) => { (db.tables.enterprise_notifications || []).forEach(n => { if (n.workspace_id === a.p_workspace_id && !n.read_by.includes(who) && (!a.p_ids || a.p_ids.includes(n.id))) n.read_by.push(who); }); return null; },
    enterprise_create_workspace: (a, who) => { const w = { id: id(), name: a.workspace_name, slug: null, phone: null, email: null, address: null, gstin: null, logo_url: null, currency: 'INR', invoice_prefix: 'INV', invoice_terms: null, bank_details: {} };
      db.tables.enterprise_workspaces.push(w); db.tables.enterprise_workspace_members.push({ id: id(), workspace_id: w.id, user_id: who, role: 'owner', status: 'active', display_name: 'Owner', email: 'o@x.com', created_at: new Date().toISOString() }); return w.id; },
    enterprise_get_public_form: a => { const f = db.tables.enterprise_inquiry_forms.find(x => x.token === a.p_token && x.is_active); if (!f) return null; const w = db.tables.enterprise_workspaces.find(x => x.id === f.workspace_id);
      return { studio: w.name, phone: w.phone, logo: w.logo_url, title: f.title, intro: f.intro, event_types: f.event_types, ask_date: f.ask_date, ask_location: f.ask_location, ask_budget: f.ask_budget, success_message: f.success_message }; },
    enterprise_submit_inquiry: a => { const f = db.tables.enterprise_inquiry_forms.find(x => x.token === a.p_token && x.is_active); const p = a.p_payload || {};
      const bad = m => { const e = new Error(m); e.rest = true; throw e; };
      if (!f) bad('This form is not accepting enquiries right now.'); if (p.website) return { ok: true, message: f.success_message };
      if (!String(p.name || '').trim()) bad('Please enter your name.'); if (!String(p.email || '').trim() && !String(p.phone || '').replace(/\D/g, '')) bad('Please enter a phone number or an email address.');
      db.tables.enterprise_leads.push({ id: id(), workspace_id: f.workspace_id, contact_name: p.name, contact_phone: p.phone || null, contact_email: (p.email || '').toLowerCase() || null, event_type: p.event_type || null, event_date: p.event_date || null, location: p.location || null, budget: Number(String(p.budget || '').replace(/[^0-9.]/g, '')) || 0, status: 'new', source: 'Enquiry form', form_id: f.id, created_at: new Date().toISOString(), message: p.message || null });
      return { ok: true, message: f.success_message }; }
  };
  db.fetch = async (url, opts) => {
    opts = opts || {}; const u = new URL(url); const hdr = opts.headers || {}; const bearer = (hdr.Authorization || '').replace('Bearer ', '');
    const body = opts.body ? JSON.parse(opts.body) : undefined; const method = opts.method || 'GET';
    const reply = (status, data) => { const t = data === undefined || data === null ? '' : JSON.stringify(data); return { ok: status < 400, status, text: async () => t, json: async () => data }; };
    db.calls.push({ method, path: u.pathname.replace('/rest/v1/', '') + u.search, body });
    if (u.pathname === '/auth/v1/token') { if (db.refreshFail) return reply(400, { message: 'refresh failed' }); db.tokenOk.add('fresh'); return reply(200, { access_token: 'fresh', refresh_token: 'r2' }); }
    const path = u.pathname.replace('/rest/v1/', ''); const anonKeyLike = bearer.startsWith('eyJ');
    if (!anonKeyLike && !db.tokenOk.has(bearer)) return reply(401, { message: 'JWT expired' });
    const who = (db.userOf && db.userOf[bearer]) || 'u-owner';
    if (path.startsWith('rpc/')) { const fn = path.slice(4); if (!rpcs[fn]) return reply(404, { message: 'no such function ' + fn });
      try { return reply(200, rpcs[fn](body || {}, who)); } catch (e) { return reply(400, { message: e.message }); } }
    const table = db.tables[path]; if (!table) return reply(404, { message: 'no such table ' + path });
    const params = [...u.searchParams.entries()];
    if (db.missingColumns && (u.searchParams.get('select') || '').includes('invoice_prefix')) return reply(400, { message: 'column enterprise_workspaces_1.invoice_prefix does not exist' });
    if (method === 'GET') {
      let rows = filterRows(table, params);
      if (path === 'enterprise_workspace_members' && (u.searchParams.get('select') || '').includes('enterprise_workspaces')) rows = rows.map(r => ({ ...r, enterprise_workspaces: db.tables.enterprise_workspaces.find(w => w.id === r.workspace_id) }));
      return reply(200, JSON.parse(JSON.stringify(rows)));
    }
    if (method === 'POST') { const row = { id: id(), created_at: new Date().toISOString(), ...body }; if (path === 'enterprise_inquiry_forms') Object.assign(row, { token: 'a1b2c3d4e5f6a1b2c3', is_active: true, title: 'Tell us about your event', intro: 'Share a few details.', event_types: ['Wedding', 'Birthday'], ask_date: true, ask_location: true, ask_budget: true, success_message: 'Thank you!' }, body);
      table.push(row); return reply(201, (opts.headers.Prefer || '').includes('representation') ? [row] : null); }
    if (method === 'PATCH') { const hit = filterRows(table, params); hit.forEach(r => Object.assign(r, body)); return reply(204, null); }
    if (method === 'DELETE') { filterRows(table, params).forEach(r => table.splice(table.indexOf(r), 1)); return reply(204, null); }
    return reply(405, { message: 'method' });
  };
  return db;
}
module.exports = { makeDb };
