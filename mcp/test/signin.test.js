import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGoogleSession, consentBody, shell, esc, SCOPE_INFO, ALWAYS_ON } from '../src/signin-page.js';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const old = '2026-01-01T00:00:00Z';
const session = (over = {}, user = {}) => ({
  access_token: 'at', refresh_token: 'rt', expires_in: 3600,
  user: { id: 'u1', created_at: old, app_metadata: { provider: 'google', providers: ['google'] }, identities: [{ provider: 'google' }], ...user },
  ...over
});

test('accepts an existing Google account', () => {
  assert.equal(checkGoogleSession(session(), NOW).ok, true);
});
test('rejects anything that did not come from Google', () => {
  const r = checkGoogleSession(session({}, { app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }] }), NOW);
  assert.equal(r.ok, false);
  assert.match(r.message, /Google/);
});
test('accepts an email account that also has Google linked', () => {
  const u = { app_metadata: { provider: 'email', providers: ['email', 'google'] }, identities: [{ provider: 'email' }, { provider: 'google' }] };
  assert.equal(checkGoogleSession(session({}, u), NOW).ok, true);
});
test('refuses a brand-new account: connecting an AI must not be how someone joins', () => {
  const r = checkGoogleSession(session({}, { created_at: new Date(NOW - 3000).toISOString() }), NOW);
  assert.equal(r.ok, false);
  assert.match(r.message, /sign in once/);
  assert.equal(checkGoogleSession(session({}, { created_at: new Date(NOW - 60000).toISOString() }), NOW).ok, true);
});
test('rejects anonymous users and incomplete sessions', () => {
  assert.equal(checkGoogleSession(session({}, { is_anonymous: true }), NOW).ok, false);
  assert.equal(checkGoogleSession(session({ refresh_token: '' }), NOW).ok, false);
  assert.equal(checkGoogleSession(null, NOW).ok, false);
  assert.equal(checkGoogleSession({ user: {} }, NOW).ok, false);
});

const details = { clientName: 'Claude <b>x</b>', clientDomain: 'claude.ai', redirectHost: 'claude.ai', redirectIsLoopback: false, scope: ['shoots:read', 'payments:read', 'summary:read', 'offline_access', 'evil:scope'] };
const page = consentBody({ details, handle: 'h"1', googleClientId: 'cid.apps.googleusercontent.com', nonce: 'N0nce' });

test('consent page has Google sign-in and no password field anywhere', () => {
  assert.match(page, /accounts\.google\.com\/gsi\/client/);
  assert.match(page, /renderButton/);
  assert.doesNotMatch(page, /type="password"|name="password"|name="email"|type="email"/i);
});
test('consent page escapes anything a connecting app controls', () => {
  assert.doesNotMatch(page, /<b>x<\/b>/);
  assert.match(page, /Claude &#60;b&#62;x&#60;\/b&#62;|Claude &lt;b&gt;/);
  assert.match(page, /value="h&#34;1"/);
});
test('only known permissions are ever offered; unknown ones are dropped', () => {
  assert.doesNotMatch(page, /evil:scope/);
  for (const s of Object.keys(SCOPE_INFO)) assert.match(page, new RegExp('value="' + s + '"'));
  for (const s of ALWAYS_ON) assert.match(page, new RegExp('type="hidden" name="scope" value="' + s + '"'));
});
test('a permission the app did not ask for is not offered', () => {
  const p = consentBody({ details: { ...details, scope: ['shoots:read'] }, handle: 'h', googleClientId: 'c', nonce: 'n' });
  assert.match(p, /type="hidden" name="scope" value="shoots:read"/);
  assert.doesNotMatch(p, /type="hidden" name="scope" value="(?:payments:read|summary:read)"/);
  assert.doesNotMatch(p, /<div class="t">(?:View payments|View summary)<\/div>/);
});
test('CSP only allows Google\'s sign-in script with the per-page nonce', () => {
  const { csp } = shell('x', { nonce: 'abc', google: true });
  assert.match(csp, /script-src 'nonce-abc' https:\/\/accounts\.google\.com\/gsi\/client/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /form-action/); // OAuth POST redirects to the validated client callback
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(shell('x').csp, /script-src 'none'/);
});
test('esc handles quotes and angle brackets', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&#60;a href=&#34;x&#34;&#62;&#38;&#39;&#60;/a&#62;');
});
