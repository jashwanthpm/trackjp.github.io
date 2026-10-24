# Sakkhi Connect — Solo MCP

A **remote MCP server** that lets ChatGPT, Claude and other MCP-compatible AI apps read a Sakkhi Solo user's own shoots, payments and yearly summary. It is read-only and each person only ever sees their own data.

## How a person connects
1. In the AI app, add the connector URL: `https://mcp.sakkhi.co.in/mcp`
2. The AI app opens a Sakkhi page showing what it wants to see. The person ticks the permissions they're happy with and presses **Continue with Google**.
3. They sign in with the **same Google account they use for Sakkhi**. That's the only way in: there is no password or email sign-in anywhere in this flow, and the AI app never receives a Sakkhi/Supabase credential.

The sign-in is the same method the Sakkhi app itself uses: the Google ID token is exchanged with Supabase (`grant_type=id_token`). A Google account that has never signed in to Sakkhi is refused (connecting an AI must not be how someone first joins), and non-Google logins are refused.

## One-time setup
1. **Google Cloud Console** → *APIs & Services → Credentials* → open the OAuth client whose ID is in `wrangler.jsonc` (`GOOGLE_CLIENT_ID`, the same one the Sakkhi app uses) → add `https://mcp.sakkhi.co.in` under **Authorized JavaScript origins**. Without this Google refuses to show its button on the connect page.
2. **Cloudflare**: the domain `sakkhi.co.in` must be in the same Cloudflare account. Create an API token from the *Edit Cloudflare Workers* template and also give it **Zone → DNS → Edit** for `sakkhi.co.in` (the deploy creates the `mcp.sakkhi.co.in` custom domain). Note the Account ID.
3. **GitHub** → repo *Settings → Secrets and variables → Actions* → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. (`SUPABASE_ANON_KEY` is optional: if missing, the workflow takes the public key from `app/index.html`. Never use a service-role key.)
4. **Deploy**: Actions → *Deploy Sakkhi Connect (MCP) to Cloudflare* → Run workflow. First run with **Switch on** *unticked*, open `https://mcp.sakkhi.co.in/health` (should show `"enabled":false,"signIn":"google"`). Then run it again with **Switch on** ticked.
5. **Connect** from ChatGPT / Claude with the URL above and sign in with Google.

Each run of the deploy workflow sets the switch from its checkbox, so tick it every time you want the connector to stay on.

## Tools and permissions
| Tool | Needs permission | What it does |
|---|---|---|
| `get_shoots` | `shoots:read` | Lists shoots (money fields only with `payments:read`) |
| `get_next_shoot` | `shoots:read` | The next upcoming shoot |
| `get_shoot_details` | `shoots:read` | One shoot by id |
| `get_editing_jobs` / `get_editing_job_details` | `shoots:read` | Own editing jobs; financial fields only with `payments:read` |
| `get_company_portal_links` | `shoots:read` | Saved company Booking and Ledger (sometimes called Lecture) links, never generates or modifies them |
| `get_pending_payments` | `payments:read` | Money still due on **completed** shoots, matching the Due figure in the Sakkhi dashboard; balances on upcoming shoots are reported separately |
| `get_year_summary` | `payments:read` + `summary:read` | Totals for a calendar year (dues count completed shoots only) |

Every tool is marked read-only. There is no write or delete tool.

## Tests
- `npm test`: unit tests (Google-only sign-in rules, consent page escaping, scopes, shoot helpers).
- `npm run test:e2e`: starts the real Worker locally plus a fake Supabase and plays the part of an AI app: registration, Google sign-in, PKCE, tokens, refresh, tools, permission limits, and isolation between two users (including when the database is too permissive). The Google button itself is simulated, because it needs a real browser.
- GitHub runs both on every change to `mcp/` (`mcp-check.yml`).

## Security notes
- Each query is filtered by the verified user id and every returned row is re-checked; mixed-owner responses fail closed.
- Authorization codes are single use (replaying one revokes what it produced), PKCE is required, consent is bound to the browser that started it.
- The connect page has a strict Content-Security-Policy that only allows Google's sign-in script.
- Audit the existing database RLS and the Supabase security advisor warnings separately; this server's explicit owner filter does not protect direct database access elsewhere.

## Not yet verified against the live services
Everything above is tested locally. Still to be confirmed once deployed: Google's button on the real `mcp.sakkhi.co.in` origin, a real ChatGPT and Claude connection, and a two-account check with real accounts. See `SECURITY-RELEASE.md`.
