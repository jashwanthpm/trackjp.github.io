import { OAuthProvider, AuthorizationError, CimdFetchError, OAuthError } from '@cloudflare/workers-oauth-provider';
import { esc, shell, consentBody, checkGoogleSession } from './signin-page.js';

// ---------------------------------------------------------------------------
// Sign-in: Google only.
//
// Sakkhi accounts are Google accounts (the app uses the Google button and trades
// the Google ID token with Supabase). This connection page does exactly the same
// thing, so there is no password anywhere in this flow and the AI app never sees
// a Sakkhi/Supabase credential.
// ---------------------------------------------------------------------------

function respond(body, { status = 200, headers, nonce, google } = {}) {
  const { doc, csp } = shell(body, { nonce, google });
  const h = new Headers(headers || undefined);       // keeps every Set-Cookie the library added
  h.set('content-type', 'text/html; charset=utf-8');
  h.set('cache-control', 'no-store');
  h.set('content-security-policy', csp);
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'no-referrer');
  return new Response(doc, { status, headers: h });
}

const errorPage = (message, status = 400) =>
  respond('<h1>Connection not completed</h1><p class="lead">' + esc(message) + '</p><p class="foot">Go back to your AI app and start the connection again.</p>', { status });

export async function authorize(request, env) {
  if (env.ENABLE_MCP_SERVER !== 'true') return errorPage('Sakkhi Connect is not enabled.', 503);
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      if (!env.GOOGLE_CLIENT_ID) return errorPage('Sakkhi connection configuration is incomplete.', 503);
      const parsed = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(parsed);   // first: a failed lookup leaves nothing behind
      const started = await oauth.beginConsent(parsed);
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      return respond(consentBody({ details, handle: started.handle, googleClientId: env.GOOGLE_CLIENT_ID, nonce }),
        { headers: started.headers, nonce, google: true });
    }
    if (request.method !== 'POST') return errorPage('Method not allowed.', 405);

    const form = await request.formData();
    const handle = String(form.get('handle') || '');
    if (form.get('deny')) {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return errorPage('Sakkhi connection configuration is incomplete.', 503);
    const credential = String(form.get('credential') || '');
    if (!credential || credential.length > 8192) return errorPage('Google sign-in did not complete. Please try again.');

    // Same exchange the Sakkhi app does after its Google button: Google ID token -> Supabase session.
    const login = await fetch(env.SUPABASE_URL + '/auth/v1/token?grant_type=id_token', {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', id_token: credential }),
      cache: 'no-store'
    });
    if (!login.ok) return errorPage('Sakkhi did not accept that Google sign-in. Use the Google account you use in Sakkhi.', 401);
    const session = await login.json();
    const checked = checkGoogleSession(session);
    if (!checked.ok) return errorPage(checked.message, 401);

    const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) });
    const completed = await oauth.completeAuthorization({
      request: approved.request,
      userId: session.user.id,
      metadata: {},
      scope: approved.request.scope,
      props: {
        userId: session.user.id,
        supabaseAccessToken: session.access_token,
        supabaseRefreshToken: session.refresh_token,
        supabaseExpiresAt: Date.now() + session.expires_in * 1000
      }
    });
    approved.headers.set('Location', completed.redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description || 'Authorization request expired.');
    if (e instanceof CimdFetchError) return errorPage('The connecting application could not be verified.');
    throw e;
  }
}

export function createProvider(apiHandler, defaultHandler) {
  return new OAuthProvider({
    apiRoute: '/mcp', apiHandler, defaultHandler,
    authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['shoots:read', 'payments:read', 'summary:read', 'offline_access'],
    resourceMetadata: { resource: 'https://mcp.sakkhi.co.in/mcp', authorization_servers: ['https://mcp.sakkhi.co.in'] },
    requiredScopes: ['shoots:read', 'payments:read', 'summary:read'], clientIdMetadataDocumentEnabled: true,
    tokenExchangeCallback: async options => {
      const p = options.props;
      if (!p?.userId || !p.supabaseRefreshToken || !options.env.SUPABASE_URL || !options.env.SUPABASE_ANON_KEY) throw new OAuthError('invalid_grant', { description: 'Reconnect your Sakkhi account.' });
      if (options.grantType === 'authorization_code' && Date.now() < p.supabaseExpiresAt - 60000) {
        return { accessTokenProps: { userId: p.userId, supabaseAccessToken: p.supabaseAccessToken, supabaseExpiresAt: p.supabaseExpiresAt }, accessTokenTTL: Math.min(3000, Math.floor((p.supabaseExpiresAt - Date.now()) / 1000)) };
      }
      const refreshed = await fetch(options.env.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: options.env.SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: p.supabaseRefreshToken }), cache: 'no-store' });
      if (!refreshed.ok) throw new OAuthError('invalid_grant', { description: 'Sakkhi session expired. Reconnect your account.' });
      const s = await refreshed.json();
      if (s.user?.id !== p.userId || !s.access_token || !s.refresh_token || !s.expires_in) throw new OAuthError('invalid_grant', { description: 'Sakkhi identity validation failed.' });
      const updated = { userId: p.userId, supabaseAccessToken: s.access_token, supabaseRefreshToken: s.refresh_token, supabaseExpiresAt: Date.now() + s.expires_in * 1000 };
      return { newProps: updated, accessTokenProps: { userId: updated.userId, supabaseAccessToken: updated.supabaseAccessToken, supabaseExpiresAt: updated.supabaseExpiresAt }, accessTokenTTL: Math.min(3000, Math.max(60, s.expires_in - 60)) };
    }
  });
}
