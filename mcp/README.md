# Sakkhi Connect — Solo MCP (initial server)

A **remote MCP server**, not a chatbot. It connects compatible MCP clients to the signed-in user's existing Sakkhi Solo `shoots` records.

## Current status
Source is committed; **not deployed or connected to ChatGPT, Claude or Gemini yet**. This initial implementation accepts a **Supabase user access token** in the Authorization header, validates it with Supabase Auth, and explicitly filters every query by the verified user's ID. It does **not** implement OAuth discovery, dynamic client registration, consent screens, token refresh, or public multi-user onboarding. Do not advertise this as a production-ready public connector or paste access tokens into third-party websites. Add a proper OAuth 2.1 authorization server and per-user revocation before public launch. Audit the existing Solo database RLS: older setup scripts included permissive policies. The MCP's explicit owner filter does not fix direct database access elsewhere.

## Setup
From `mcp/`: `npm install`; configure the public Supabase anon/publishable key as a Worker secret using `npx wrangler secret put SUPABASE_ANON_KEY`; `npm run dev` or `npm run deploy` after security review. Never use a Supabase service-role key. Set `ALLOWED_ORIGINS` only for trusted browser MCP clients, when necessary. The deployed endpoint is `https://<worker-host>/mcp` and health is `/health`.

## Tools
`get_shoots`, `get_next_shoot`, `get_shoot_details`, `get_pending_payments`, `get_year_summary`, `create_shoot`. The create tool writes a real booking, so clients must request explicit user confirmation before invoking it. No payment mutation or deletion in V1.

## Next release before general user connections
Implement OAuth 2.1 + PKCE, client registration/metadata, consent and revoke UI in Sakkhi, token storage and rotation, rate limits, per-user audit logging, production RLS migration, and end-to-end tests against a test Solo account. Verify each target AI platform's current MCP connector requirements separately.

## OAuth storage provisioned (2026-10-20)
A dedicated Cloudflare KV namespace named `SAKKHI_MCP_OAUTH` has been created and bound as `OAUTH_KV` in `wrangler.jsonc`. The OAuth provider dependency is installed in the manifest, but **no authorization server is wired to it yet**. Keep `ENABLE_MCP_SERVER=false`; KV alone does not authenticate users or protect MCP tokens. The server still uses direct Supabase bearer tokens in its prototype handler, which is unsuitable for public AI connector onboarding. Do not deploy publicly until consent, OAuth token issuance/refresh/revocation and isolation tests are complete.

## OAuth implementation added (2026-10-20)
`src/oauth.js` now implements the provider's browser-bound consent helpers, Supabase password sign-in, OAuth authorization completion and upstream Supabase session rotation through `tokenExchangeCallback`. `src/index.js` now routes through OAuthProvider and validates Supabase identity on every MCP request. Tool exposure follows granted scopes. Financial fields are omitted from shoot read tools without `payments:read`. Write scope is deliberately not offered in OAuth V1.

**Not yet production verified.** This OAuth sign-in path currently supports email/password, not every Supabase login/MFA method. Do not switch on the Worker for general customers until dependency installation, Worker build, OAuth discovery, sign-in, PKCE, consent denial, token refresh/revocation and cross-user isolation have been tested against dedicated test accounts. No production deployment or customer connections were performed by this code commit. The MCP resource URL in `oauth.js` is a proposed hostname; provision and verify `mcp.sakkhi.co.in` before deployment. Review the Supabase security advisor warnings.

### Required verification
- `cd mcp && npm install && npm run check && npx wrangler deploy --dry-run`
- Provision `SUPABASE_ANON_KEY` as a Worker secret (public anon/publishable key only; never service role)
- Verify `OAUTH_KV` binding, real hostname, OAuth discovery and authorization code + PKCE
- Confirm denied consent never creates a grant; confirm token revocation prevents subsequent access
- Confirm User A cannot see User B's shoots; confirm `shoots:read` cannot reveal financial fields
- Confirm refresh rotation works and expired Supabase sessions fail closed
- Add tested rate limiting and audit trails before enabling writes
