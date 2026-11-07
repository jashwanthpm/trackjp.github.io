/* Sakkhi Enterprise shared runtime: session, data access, workspace, helpers. */
(function () {
  'use strict';
  const SUPABASE_URL = 'https://smyupcjfusgduaoxqfvu.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNteXVwY2pmdXNnZHVhb3hxZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NjA3MzIsImV4cCI6MjA5NTQzNjczMn0.pGg9ZIYWpZ70R_HNtRl7FHrzeUNA5vlZT6hNkjDzhqo';

  // ---- session (written by the Sakkhi sign-in; shared with the Solo app) ----
  function store() { return localStorage.getItem('currentUser') ? localStorage : (sessionStorage.getItem('currentUser') ? sessionStorage : null); }
  function user() { const s = store(); if (!s) return null; try { return JSON.parse(s.getItem('currentUser')); } catch (e) { return null; } }
  function saveUser(u) { const s = store() || localStorage; s.setItem('currentUser', JSON.stringify(u)); }

  let refreshing = null;
  function refreshSession() {
    if (refreshing) return refreshing;
    const u = user();
    if (!u || !u.refreshToken) return Promise.resolve(false);
    refreshing = fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: u.refreshToken })
    }).then(async r => {
      if (!r.ok) return false;
      const d = await r.json(); const cur = user() || u;
      cur.token = d.access_token; cur.refreshToken = d.refresh_token || cur.refreshToken; saveUser(cur); return true;
    }).catch(() => false).finally(() => { refreshing = null; });
    return refreshing;
  }

  class EntError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

  // ---- data access (PostgREST + RPC) ----
  async function sb(path, o) {
    o = o || {};
    const send = () => {
      const u = user();
      const h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (o.anon ? SUPABASE_KEY : ((u && u.token) || SUPABASE_KEY)), 'Content-Type': 'application/json' };
      if (o.prefer) h.Prefer = o.prefer;
      return fetch(SUPABASE_URL + '/rest/v1/' + path, { method: o.method || 'GET', headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    };
    let r = await send();
    if (r.status === 401 && !o.anon && await refreshSession()) r = await send();
    const text = await r.text(); let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!r.ok) throw new EntError((data && (data.message || data.error || data.hint)) || ('Request failed (' + r.status + ')'), r.status);
    return data;
  }
  const rpc = (name, args, o) => sb('rpc/' + name, Object.assign({ method: 'POST', body: args || {} }, o || {}));
  const q = v => encodeURIComponent(v);

  // ---- roles ----
  const LEAD = ['owner', 'admin', 'manager'], MONEY = ['owner', 'admin', 'manager', 'finance'];
  const PERMS = { leads: MONEY, forms: LEAD, invoices: MONEY, clients: MONEY, team: LEAD, settings: LEAD, dashboard: MONEY };
  const can = (role, what) => (PERMS[what] || []).indexOf(role) !== -1;

  // ---- workspace bootstrap (the shell computes it once; pages in the frame reuse it) ----
  async function loadContext() {
    const u = user();
    if (!u || !u.id) return null;
    const base = 'enterprise_workspace_members?user_id=eq.' + q(u.id) + '&status=eq.active&select=workspace_id,role,display_name,';
    let rows, needsMigration = false;
    try {
      rows = await sb(base + 'enterprise_workspaces(id,name,slug,phone,email,address,gstin,logo_url,currency,invoice_prefix,invoice_terms,bank_details)&order=created_at.asc');
    } catch (e) {
      // The pages were uploaded before the one-time database update was run: the new company columns do not exist yet.
      if (e.status === 400 && /column|schema cache|does not exist/i.test(e.message)) {
        needsMigration = true;
        rows = await sb(base + 'enterprise_workspaces(id,name)&order=created_at.asc');
        rows.forEach(r => { if (r.enterprise_workspaces) Object.assign(r.enterprise_workspaces, { currency: 'INR', phone: null, address: null }); });
      } else throw e;
    }
    if (!rows || !rows.length) return { user: u, ws: null, role: null, memberships: [] };
    const want = sessionStorage.getItem('ent_ws');
    const m = rows.find(r => r.workspace_id === want) || rows[0];
    return { user: u, ws: m.enterprise_workspaces, role: m.role, memberships: rows, needsMigration };
  }
  async function init() {
    try { if (window.parent && window.parent !== window && window.parent.ENT_CTX) return window.parent.ENT_CTX; } catch (e) { /* cross-origin parent */ }
    const ctx = await loadContext();
    if (!ctx) { location.href = '/'; return new Promise(() => {}); }
    window.ENT_CTX = ctx; return ctx;
  }
  async function createWorkspace(name) { await rpc('enterprise_create_workspace', { workspace_name: name }); sessionStorage.removeItem('ent_ws'); return loadContext(); }

  // ---- formatting ----
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, cur) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const day = d => { if (!d) return ''; const t = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d); return isNaN(t) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const dayShort = d => { if (!d) return ''; const t = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d); return isNaN(t) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
  const todayStr = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };
  function ago(ts) {
    const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago'; return day(ts);
  }
  const digits = p => String(p || '').replace(/[^0-9]/g, '');
  const waLink = (phone, text) => { let d = digits(phone); if (d.length === 10) d = '91' + d; return d ? 'https://wa.me/' + d + (text ? '?text=' + q(text) : '') : ''; };
  const debounce = (fn, ms) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms || 250); }; };

  // ---- toast + confirm ----
  function toast(msg, type) {
    let w = document.getElementById('e-toasts');
    if (!w) { w = document.createElement('div'); w.id = 'e-toasts'; w.className = 'e-toast-wrap'; document.body.appendChild(w); }
    const t = document.createElement('div'); t.className = 'e-toast ' + (type || ''); t.textContent = msg; w.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3200);
  }
  function confirmBox(msg, opts) {
    opts = opts || {};
    return new Promise(res => {
      const ov = document.createElement('div'); ov.className = 'e-overlay open'; ov.style.zIndex = 70;
      const m = document.createElement('div'); m.className = 'e-modal open'; m.style.zIndex = 71;
      m.innerHTML = '<div style="padding:22px"><p style="font-size:14px;font-weight:700;color:#fff;margin-bottom:6px">' + esc(opts.title || 'Are you sure?') + '</p><p class="e-sub" style="line-height:1.5">' + esc(msg) + '</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px"><button class="e-btn" data-r="0">Cancel</button><button class="e-btn ' + (opts.danger ? 'danger' : 'primary') + '" data-r="1">' + esc(opts.ok || 'Confirm') + '</button></div></div>';
      const done = v => { ov.remove(); m.remove(); res(v); };
      m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); });
      ov.addEventListener('click', () => done(false));
      document.body.append(ov, m);
    });
  }

  // ---- CSV export ----
  function csv(rows, columns, filename) {
    const cell = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [columns.map(c => cell(c.label)).join(',')].concat(rows.map(r => columns.map(c => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  window.ENT = { SUPABASE_URL, SUPABASE_KEY, user, sb, rpc, q, can, init, loadContext, createWorkspace, esc, money, day, dayShort, todayStr, ago, digits, waLink, debounce, toast, confirm: confirmBox, csv, EntError, PERMS };
})();
