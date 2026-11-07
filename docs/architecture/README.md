# Sakkhi Repository Architecture

This document defines the repository boundaries for the Sakkhi platform. The intent is to keep Platform Admin, Solo Creator, and Enterprise separate while allowing carefully selected shared services.

## Current repository layout

```text
/
├── admin/                  # Platform administration UI
│   ├── index.html
│   └── create/
├── app/                    # Solo Creator application shell
│   └── index.html
├── enterprise/             # Enterprise / studio application
│   ├── index.html
│   ├── dashboard.html
│   ├── clients.html
│   ├── calendar.html
│   ├── crm.html
│   ├── invoices.html
│   ├── pipelines.html
│   ├── quotation.html
│   ├── team.html
│   ├── account.html
│   └── invite.html
├── booking/                # Existing Solo Creator route (legacy URL)
├── ledger/                 # Existing Solo Creator route (legacy URL)
├── quotation/              # Existing Solo Creator route (legacy URL)
├── shooters/               # Existing Solo Creator route (legacy URL)
├── meeting/                # Existing Solo Creator route (legacy URL)
├── notifications/          # Existing Solo Creator route (legacy URL)
├── deep_analysis/          # Existing Solo Creator route (legacy URL)
├── enquiry/                # Public Enterprise enquiry entry point
├── connect/                # Sakkhi Connect / MCP connection UI
├── mcp/                    # MCP service, OAuth and tests
├── supabase/               # Database migrations and Edge Functions
├── cloudflare/             # Cloudflare Worker integrations
├── .github/workflows/      # CI and deployment workflows
├── docs/                   # Project documentation
└── [root PWA assets]       # Shared icons, manifest, service workers, CNAME
```

## Ownership boundaries

### Platform Admin — `/admin/`
Platform-wide administration only: platform dashboard, user and studio administration, subscription/billing operations, support tooling, and platform configuration. It must not become the home for an individual photographer's day-to-day shoot management.

### Solo Creator — `/app/`
The individual photographer's application. The current application shell is `app/index.html`. Existing public routes such as `/booking/`, `/ledger/`, `/quotation/`, `/shooters/`, `/meeting/`, `/notifications/`, and `/deep_analysis/` are Solo Creator modules that currently live at the repository root for URL compatibility.

### Enterprise — `/enterprise/`
Studio and production-house workflows: workspace dashboard, CRM/leads, clients, calendar, pipelines, invoices, quotations, team, account and invitations. The public enquiry entry point remains at `/enquiry/`.

### Shared platform services
- `/supabase/`: database migrations and Edge Functions used by the platform. Database access must remain tenant/workspace scoped and protected by RLS.
- `/mcp/`: Sakkhi Connect service, OAuth and MCP implementation.
- `/cloudflare/`: Cloudflare Worker integrations.
- `/.github/workflows/`: CI and deployment automation.
- Root PWA files (manifest, service workers, icons, CNAME) remain at the root because browsers and GitHub Pages expect those paths.

## Target organization (logical ownership)

The long-term logical structure is:

```text
admin/                  # Platform Admin UI and admin-only assets
app/                    # Solo Creator shell and Solo Creator modules
  modules/               # Destination for Solo Creator feature modules
enterprise/             # Enterprise UI and enterprise-only assets
  assets/                # Enterprise CSS, JS and images
enquiry/                 # Public Enterprise enquiry experience
shared/                  # Only genuinely reusable UI/utilities
supabase/
  migrations/
  functions/
mcp/
cloudflare/
tests/
docs/
.github/workflows/
```

## Migration rules

1. Do not move the existing root-level Solo Creator routes until their inbound links, absolute asset paths, service-worker behavior, and authentication redirects have been checked.
2. When those routes are moved under `app/modules/`, retain compatibility entry points at the old URLs (or equivalent redirects) so saved links and existing integrations continue to work.
3. Keep Enterprise pages, styles and scripts inside `enterprise/`; do not import Solo Creator page-specific code into Enterprise.
4. Keep Platform Admin code inside `admin/`; only reusable, non-privileged components may move to `shared/`.
5. Do not duplicate authentication or weaken authorization to make cross-area navigation easier. Shared sign-in may identify the user, but each area must enforce its own role and data access.
6. Keep database migrations in one ordered Supabase migration stream. Use clear naming and RLS policies to preserve tenant boundaries; do not split migrations into separate folders unless the deployment process is updated to apply them in a deterministic order.
7. Keep root PWA assets and existing route URLs stable until a tested compatibility migration is ready.

## Safe implementation order

1. Establish and maintain these ownership boundaries (this document).
2. Complete the Enterprise Stage 1 integration after checking it against the current Enterprise pages and migration history.
3. Extract Solo Creator route modules behind compatibility routes, one feature at a time.
4. Extract genuinely shared components and utilities only after both consumers are identified.
5. Add route, smoke, and permission tests before changing production URLs.

This document is an architecture guide, not an instruction to move or delete existing production files in one operation.
