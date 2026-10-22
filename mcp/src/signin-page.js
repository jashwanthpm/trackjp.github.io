// Pure helpers for the Google sign-in / consent page. Kept apart from oauth.js (which needs the
// Cloudflare runtime) so they can be unit-tested with plain Node.
const LOGO = 'https://sakkhi.co.in/icon-192.png';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

// What each permission means, in plain words. Anything not listed here is never shown or granted.
export const SCOPE_INFO = {
  'shoots:read': ['View your shoots', 'Names, dates, places and event details'],
  'payments:read': ['View payment amounts', 'Amounts, money received and pending dues'],
  'summary:read': ['View yearly summaries', 'Totals per year (also needs payment access)'],
  'offline_access': ['Stay connected', 'Keeps the connection working without signing in again every hour']
};
// Always part of a connection: reading shoots is the whole point, and without
// offline_access the link would stop working after the first hour.
export const ALWAYS_ON = ['shoots:read', 'offline_access'];

const STYLE = `
*{box-sizing:border-box}
body{margin:0;background:#050505;color:#e8e8e8;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
main{width:100%;max-width:440px;background:#0f0f0f;border:1px solid #1f1f1f;border-radius:18px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.logo{display:block;width:56px;height:56px;border-radius:14px;margin:0 auto 16px}
h1{font-size:20px;margin:0 0 6px;text-align:center;color:#fff;letter-spacing:.2px}
p{margin:0 0 12px;color:#a3a3a3;font-size:14px}
.lead{text-align:center;color:#d4d4d4}
.lead strong{color:#fff}
.meta{background:#0a0a0a;border:1px solid #1f1f1f;border-radius:10px;padding:10px 12px;font-size:12px;color:#8a8a8a;margin:14px 0}
.meta b{color:#c9c9c9;font-weight:600}
.warn{background:#2a1c10;border:1px solid #6b4a1e;color:#e7b97a;border-radius:10px;padding:10px 12px;font-size:12.5px;margin:0 0 14px}
.label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#737373;font-weight:700;margin:16px 0 8px}
ul{list-style:none;margin:0 0 6px;padding:0}
li{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid #1f1f1f;border-radius:10px;margin-bottom:8px;background:#0a0a0a}
li input{margin-top:3px;accent-color:#c9a96e}
li .t{color:#f1f1f1;font-size:14px;font-weight:600}
li .d{color:#8a8a8a;font-size:12px}
li .tag{margin-left:auto;font-size:10px;color:#6b6b6b;white-space:nowrap;padding-top:3px}
.hint{font-size:12.5px;text-align:center;margin:16px 0 12px}
.gbtn{display:flex;justify-content:center;min-height:44px}
.status{text-align:center;font-size:13px;color:#c9a96e;min-height:18px;margin-top:8px}
button.secondary{display:block;width:100%;margin-top:10px;padding:11px;border:1px solid #2a2a2a;background:transparent;color:#a3a3a3;border-radius:10px;font:inherit;font-size:13px;cursor:pointer}
button.secondary:hover{color:#fff;border-color:#444}
.foot{margin-top:16px;font-size:11.5px;color:#666;text-align:center}
a{color:#c9a96e}
`;

/** Wraps page content in the Sakkhi look + a strict CSP. `google` loosens it just enough for Google's button. */
export function shell(body, { nonce = '', google = false } = {}) {
  const csp = [
    "default-src 'none'",
    google ? `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client` : "script-src 'none'",
    google ? 'frame-src https://accounts.google.com/gsi/' : "frame-src 'none'",
    google ? 'connect-src https://accounts.google.com/gsi/' : "connect-src 'none'",
    "style-src 'unsafe-inline'" + (google ? ' https://accounts.google.com/gsi/style' : ''),
    'img-src https://sakkhi.co.in data: https://*.googleusercontent.com',
    // OAuth completion redirects the POST to the registered AI client callback.
    // A form-action self restriction also blocks that redirect in browsers enforcing it.
    // The form itself has no external action; the OAuth provider validates redirect URIs.
    "frame-ancestors 'none'",
    "base-uri 'none'"
  ].join('; ');
  const doc = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="dark"><meta name="robots" content="noindex">'
    + '<title>Connect Sakkhi</title><style>' + STYLE + '</style></head><body><main>'
    + '<img class="logo" src="' + LOGO + '" alt="Sakkhi">' + body + '</main></body></html>';
  return { doc, csp };
}

/** The consent + Google sign-in page. Exported so it can be unit-tested. */
export function consentBody({ details, handle, googleClientId, nonce }) {
  const asked = new Set(details.scope || []);
  const rows = [];
  for (const scope of Object.keys(SCOPE_INFO)) {
    const [title, desc] = SCOPE_INFO[scope];
    if (ALWAYS_ON.includes(scope)) {
      rows.push('<li><input type="hidden" name="scope" value="' + esc(scope) + '"><span style="color:#c9a96e">&#10003;</span><div><div class="t">' + esc(title) + '</div><div class="d">' + esc(desc) + '</div></div><span class="tag">always</span></li>');
    } else if (asked.has(scope)) {
      rows.push('<li><input type="checkbox" name="scope" value="' + esc(scope) + '" checked><div><div class="t">' + esc(title) + '</div><div class="d">' + esc(desc) + '</div></div></li>');
    }
  }
  const publisher = details.clientDomain
    ? 'Published by <b>' + esc(details.clientDomain) + '</b>'
    : 'This app registered itself, so its name is not verified';
  const script = 'window.onGoogleLibraryLoad=function(){'
    + 'google.accounts.id.initialize({client_id:' + JSON.stringify(googleClientId).replace(/</g, '\\u003c') + ',auto_select:false,callback:function(r){'
    + 'if(!r||!r.credential)return;document.getElementById("credential").value=r.credential;'
    + 'document.getElementById("status").textContent="Signing you in\u2026";document.getElementById("f").submit();}});'
    + 'google.accounts.id.renderButton(document.getElementById("gbtn"),{theme:"filled_black",size:"large",shape:"pill",text:"continue_with",width:290});};';
  return '<h1>Connect Sakkhi</h1>'
    + '<p class="lead"><strong>' + esc(details.clientName) + '</strong> would like to view your Sakkhi data.</p>'
    + '<div class="meta">' + publisher + '<br>Access will be sent to <b>' + esc(details.redirectHost) + '</b></div>'
    + (details.redirectIsLoopback ? '<div class="warn">This sends access to an app running on this computer. Continue only if you just started the connection from it.</div>' : '')
    + '<form id="f" method="post"><input type="hidden" name="handle" value="' + esc(handle) + '"><input type="hidden" name="credential" id="credential">'
    + '<div class="label">This app will be able to</div><ul>' + rows.join('') + '</ul>'
    + '<p class="hint">Continue with the same Google account you use for Sakkhi.</p>'
    + '<div class="gbtn" id="gbtn"></div><noscript><p class="status">JavaScript is needed to sign in with Google.</p></noscript>'
    + '<div class="status" id="status"></div>'
    + '<button class="secondary" type="submit" name="deny" value="1" formnovalidate>Cancel</button></form>'
    + '<p class="foot">Read-only. You can disconnect at any time. Never approve a request you did not start.</p>'
    + '<script nonce="' + esc(nonce) + '" src="https://accounts.google.com/gsi/client" async defer></script>'
    + '<script nonce="' + esc(nonce) + '">' + script + '</script>';
}

/**
 * Checks the Supabase session we got back for the Google ID token.
 * Returns { ok: true } or { ok: false, message }.
 */
export function checkGoogleSession(session, now = Date.now()) {
  const u = session && session.user;
  if (!u || !u.id || u.is_anonymous) return { ok: false, message: 'Sakkhi did not return a signed-in account.' };
  if (!session.access_token || !session.refresh_token || !session.expires_in) return { ok: false, message: 'Incomplete Sakkhi session.' };
  const providers = [].concat(u.app_metadata?.provider || [], u.app_metadata?.providers || [], (u.identities || []).map(i => i.provider));
  if (!providers.includes('google')) return { ok: false, message: 'This connection only supports signing in with Google.' };
  // The Google sign-in creates a Sakkhi login if the email is new. An AI connection should
  // never be how someone first joins, so a just-created account is refused: sign up in Sakkhi first.
  const created = Date.parse(u.created_at || '');
  if (Number.isFinite(created) && now - created < 20000) {
    return { ok: false, message: 'No Sakkhi account was found for this Google account. Open sakkhi.co.in, sign in once, then connect again.' };
  }
  return { ok: true };
}

