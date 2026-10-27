# Omi OAuth `invalid_target` investigation

The Omi screen shows `127.0.0.1:63869/callback?error=invalid_target&error_description=The+resource+parameter+must+name+exactly+one+configured+protected...`. This is an OAuth authorization redirect error, **not** proof that MCP tools or Supabase sign-in failed.

## Current configuration
- MCP endpoint and configured protected resource: `https://mcp.sakkhi.co.in/mcp`
- Authorization server: `https://mcp.sakkhi.co.in`
- OAuth library: `@cloudflare/workers-oauth-provider ^1.2.0`
- Current e2e coverage uses precisely the configured resource, so it cannot detect a client sending a different target.

## Reproduction / diagnosis (do not paste codes, tokens, or credentials into issues)
1. Inspect Omi's outgoing `/authorize` request (browser Network, preserve log). Record only the **names and count** of `resource` parameters, and redact all other parameter values except the resource URL(s).
2. Check whether it sends zero, one, or multiple `resource` values. Compare the single value, after URL decoding, with `https://mcp.sakkhi.co.in/mcp` (including path and trailing slash). A resource naming the authorization server origin alone is not the configured protected resource.
3. Inspect `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; ensure the former advertises the exact resource and the authorization server, and that the authorization server endpoints resolve.
4. If Omi sends a different URL, first try reconnecting with exactly `https://mcp.sakkhi.co.in/mcp` and an empty API key. If it still sends a different resource, capture the redacted request for an Omi compatibility report.
5. If Omi sends the exact configured URL once, reproduce with the installed provider version and investigate its target validation; do not weaken resource/audience checks, PKCE, consent, or user isolation.
6. Run `cd mcp && npm ci && npm run check && npm test && npm run test:e2e` in an environment with Wrangler and the local e2e configuration before any deployment.

The screenshot alone does not expose Omi's outgoing `resource` value, so the precise cause remains unverified. Do not deploy a guessed OAuth bypass.
