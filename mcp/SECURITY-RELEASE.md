# Sakkhi Solo MCP — live integration audit (2026-10-20)

## Update 2026-10-22: Google-only sign-in
- The connect page no longer asks for an email/password. It uses **Continue with Google** and exchanges the Google ID token with Supabase exactly like the Sakkhi app. Password grants are never attempted (asserted in the end-to-end test).
- Sessions that did not come from Google, anonymous sessions, and accounts created by the sign-in itself (never seen in Sakkhi before) are refused.
- Pending/summary tools now count dues on completed shoots only, matching the dashboard; upcoming balances are reported separately.
- All tools carry read-only annotations. The connect page has a nonce-based CSP allowing only Google's sign-in script.
- Locally verified (`npm test`, `npm run test:e2e`): 17 unit tests and 13 end-to-end tests covering registration, PKCE, consent denial, wrong/forged credentials, a hijack attempt without the browser cookie, code replay (revokes the grant), refresh rotation, permission limits and two-user isolation even with a too-permissive database.
- **Not yet verified live:** Google's button on the real origin (needs the origin added in Google Cloud Console), real ChatGPT/Claude connections, and a two-real-account test.

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

## Security hardening status (2026-10-20)
- **Read-only first release**: `create_shoot` has been removed from runtime registration; `shoots:write` is not an advertised OAuth scope. Health reports `writes:false` regardless of configuration.
- **Account isolation**: each Supabase REST query filters by the verified Supabase Auth user ID, every returned row is checked against that ID, and mixed-owner responses fail closed (including the separate single-shoot lookup). This is intentional defense in depth because `public.shoots` has both an own-user RLS policy and a broader master-admin RLS policy. Do not remove or alter the latter without auditing Sakkhi's admin UI.
- **Financial permissions**: shoot reads omit amount/paid/pending/payment status unless the OAuth grant includes `payments:read`; payment and summary tools require their explicit scopes.
- **Token minimization**: OAuth access-token props omit the Supabase refresh token. The refresh token is retained only in the server-side OAuth grant props.
- **No silent summary truncation**: reads paginate in batches of 500 and fail closed beyond the supported collection size.
- **Not certified live**: GitHub connector currently does not expose a successful workflow run for the latest commits, and this environment could not reach npm to run the build. A private two-account end-to-end OAuth test is still required before setting `ENABLE_MCP_SERVER=true` or routing `mcp.sakkhi.co.in`.

### Mandatory private acceptance test
1. Install dependencies and run the GitHub workflow to green (including Wrangler dry-run and local disabled Worker smoke test).
2. Configure `SUPABASE_ANON_KEY` as a Cloudflare Worker secret; never use a service-role key. Set up the OAuth KV binding and a controlled preview URL, leaving the public release flag disabled until a separate private test environment is prepared.
3. Connect test user A, grant `shoots:read` only, and verify no financial fields or payment/summary tools are exposed. Connect test user B with a different set of shoots; verify A cannot fetch B's ID or see B's data in list, next shoot, payments, or summaries, including when A has master-admin privileges.
4. Test explicit denial, a wrong Google account, expired session, token refresh, token revocation, malformed IDs and invalid dates. Ensure the same OAuth token cannot be used after revocation.
5. Only after passing, configure the real `mcp.sakkhi.co.in` hostname, repeat discovery/PKCE/consent tests on the actual HTTPS origin, then enable read-only access. Keep writes disabled.
