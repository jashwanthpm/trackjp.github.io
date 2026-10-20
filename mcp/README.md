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
