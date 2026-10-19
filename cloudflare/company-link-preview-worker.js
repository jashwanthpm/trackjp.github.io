// Cloudflare Worker: attach per-company social previews to the existing GitHub Pages
// booking and ledger pages. Configure SUPABASE_URL and SUPABASE_ANON_KEY as Worker secrets.
// Routes: saki.co.in/booking* and saki.co.in/ledger* (also add www routes if used).
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);
const REF_RE = /^[a-zA-Z0-9_.\-~]{3,128}$/;
async function studioName(env, kind, ref) {
  if (!REF_RE.test(ref) || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return '';
  const fn = kind === 'booking' ? 'get_booking_portal' : 'get_ledger_portal';
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {'content-type':'application/json', apikey:env.SUPABASE_ANON_KEY, authorization:'Bearer ' + env.SUPABASE_ANON_KEY},
    body: JSON.stringify({p_ref:ref}),
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) return '';
  const data = await response.json();
  if (!data || typeof data !== 'object') return '';
  // The booking link is company-specific: studio is the selected company.
  // The ledger RPC's companyName identifies the client/company on that link.
  return cleanName(kind === 'booking' ? (data.studio || data.bizName || data.name) : (data.companyName || data.profile?.bizName));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const kind = /^\/booking(?:\/|$)/.test(url.pathname) ? 'booking' : /^\/ledger(?:\/|$)/.test(url.pathname) ? 'ledger' : '';
    const original = await fetch(request);
    if (!kind || request.method !== 'GET' || !original.ok || !(original.headers.get('content-type') || '').includes('text/html')) return original;
    const ref = url.searchParams.get('ref') || '';
    let name = '';
    try { name = await studioName(env, kind, ref); } catch (_) { /* preserve original page on RPC failure */ }
    const type = kind === 'booking' ? 'Booking Link' : 'Client Ledger';
    const title = (name ? name + ' | ' : '') + type;
    const description = kind === 'booking'
      ? 'Submit your shoot booking request' + (name ? ' with ' + name : '') + '.'
      : 'View the secure client ledger' + (name ? ' for ' + name : '') + '.';
    const html = await original.text();
    const metadata = [
      '<title>' + escapeHtml(title) + '</title>',
      '<meta name="description" content="' + escapeHtml(description) + '">',
      '<meta property="og:type" content="website">',
      '<meta property="og:title" content="' + escapeHtml(title) + '">',
      '<meta property="og:description" content="' + escapeHtml(description) + '">',
      '<meta property="og:url" content="' + escapeHtml(url.href) + '">',
      '<meta name="twitter:card" content="summary">',
      '<meta name="twitter:title" content="' + escapeHtml(title) + '">',
      '<meta name="twitter:description" content="' + escapeHtml(description) + '">'
    ].join('\n');
    // Replace all static metadata so crawlers see only the company-specific version.
    const modified = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, '')
      .replace(/<meta\s+(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+)["'][^>]*>/gi, '')
      .replace(/<\/head>/i, metadata + '\n</head>');
    const headers = new Headers(original.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('cache-control', 'public, max-age=0, s-maxage=300');
    headers.set('content-type', 'text/html; charset=utf-8');
    return new Response(modified, {status:original.status, statusText:original.statusText, headers});
  }
};
