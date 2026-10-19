# Sakkhi Solo MCP — live integration audit (2026-10-20)

## Verified against connected Supabase project
- Project ref matches `mcp/wrangler.jsonc`.
- `public.shoots` and `public.settings` have RLS enabled.
- `shoots` has a user-owned authenticated policy comparing `auth.uid()::text` to `user_id`, plus a separate master-admin policy.
- The MCP explicitly filters by the verified user ID as additional defence in depth. The server must never use a service-role key.
- `settings` has an owner policy plus a master-admin policy.

## Security review before public rollout
Supabase security advisors reported existing warnings, notably publicly executable SECURITY DEFINER functions and mutable function search paths. These predate this MCP implementation and may be used by the current app. Review individually before revoking or modifying privileges; **no production schema changes were made during this audit**.
Reference: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

## Remaining release blockers
1. Implement a standards-compliant OAuth authorization server with PKCE and per-user Sakkhi consent/revocation; the current Worker accepts direct Supabase user tokens only and must not be marketed as a ChatGPT/Claude/Gemini public connection.
2. Configure and deploy Worker secret `SUPABASE_ANON_KEY` (publishable/anon key, never service-role); verify exact Cloudflare account and hostname.
3. Verify MCP transport and all six tools with a real dedicated test account, including isolation between two test users and rejection of expired tokens.
4. Audit and resolve database security findings without breaking public booking flows.
5. Add rate limits, per-user action audit log, and explicit confirmation UX for writes.
6. Verify each AI platform's current remote MCP OAuth connection flow.

## Smoke test after deployment
- `GET /health` responds with service status.
- Unauthenticated `POST /mcp` responds 401.
- Invalid bearer token responds 401.
- An authenticated `initialize`, `tools/list`, and `tools/call` sequence succeeds.
- User A cannot retrieve User B's shoot ID.
- Create shoot appears in User A's Solo app only, after user approval.
