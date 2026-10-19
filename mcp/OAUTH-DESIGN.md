# Sakkhi Connect — OAuth connection design

This is the next implementation stage, **not yet a functioning OAuth endpoint**. The existing Worker remains disabled by default. No access tokens should be pasted into third-party AI apps.

## Standards-based approach

Use Cloudflare's maintained `@cloudflare/workers-oauth-provider` v1 rather than inventing token endpoints. The provider must support MCP OAuth discovery, Authorization Code + PKCE (S256), client metadata and/or dynamic client registration as supported by the target AI client, refresh tokens, consent, and revocation. Documentation: https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ and https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/

## User flow
1. AI client discovers the Sakkhi authorization server from the MCP resource metadata.
2. Browser opens a Sakkhi-hosted sign-in/consent page. Existing Supabase Auth handles identity. Never accept an email or `user_id` supplied by the AI client as proof of identity.
3. Consent displays the requesting client, requested scopes, and whether write access is included. Store grant by verified Supabase `auth.uid()`, client and scope; allow revocation in Solo settings.
4. Issue an MCP-scoped OAuth access token with audience limited to the Sakkhi MCP resource. Never forward Supabase refresh/access tokens to AI clients.
5. MCP resource server validates issuer, audience, expiration and scopes, resolves user ID from the trusted token/grant, then queries Solo data through verified user-level permissions.
6. Every tool is checked against its granted scope. Write actions additionally require user confirmation at the AI platform, server-side authorization, idempotency and audit trail.

## Scopes
- `shoots:read`: get_shoots, get_next_shoot, get_shoot_details
- `payments:read`: get_pending_payments
- `summary:read`: get_year_summary
- `shoots:write`: create_shoot (not enabled by default)
- No delete or payment mutation scopes in V1.

## Security gates
- Redirect URI must be validated against registered client metadata; no wildcard callbacks.
- PKCE S256 mandatory for public clients; state and CSRF checks; short-lived single-use authorization codes.
- User consent must never be auto-approved solely because the user is signed into Sakkhi.
- Token revocation and disconnect must invalidate future MCP access.
- Never log bearer tokens, auth codes or client secrets.
- Per-user and per-client rate limiting; per-action audit logging; two-user isolation tests.
- Review current Supabase policies and privileged public RPC functions before launch.

## Current repository state
`mcp/wrangler.jsonc` sets `ENABLE_MCP_SERVER=false` and `ENABLE_MCP_WRITES=false`. This is intentional: source code is not production-ready. Only turn these on after the above OAuth flow is implemented and tested.
