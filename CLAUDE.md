# CLAUDE.md — Rasmalak CRM

This is the primary reference for any AI assistant working on this repository. Read it fully before making changes.

---

## What This Project Is

**Rasmalak CRM** (placeholder product name) is a bilingual, Arabic-first CRM for small businesses in the MENA region: contacts, companies, deals and pipeline, tasks, communications, automation, documents and integrations. It is a separate product from the consumer Rasmalak app, with its own repository, Supabase project and Vercel project.

The **SME Jordan** build adds financial intelligence, playbooks, an AI business assistant, calculators and a compliance navigator for Jordanian businesses. It follows `docs/SME_JORDAN_CURSOR_PLAYBOOK.md`; see the SME section below.

Arabic is the default language and RTL the default direction.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, webpack mode) |
| UI | React 19, TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 via `@tailwindcss/postcss`, plus CSS variables and inline styles using `--ds-*` tokens |
| Backend / Auth / DB | Supabase (Auth + PostgreSQL + RLS), Supabase CLI migrations |
| Client state | Zustand 5 (UI preferences, auth) and React context providers (CRM data) |
| i18n | react-intl 8 |
| Validation | zod |
| Money and rates | bigint minor units (`src/sme/money`), decimal.js |
| Spreadsheets | SheetJS 0.20.3 from the vendor tarball (reading uploads); in-house XLSX writer |
| PDF | In-house writer with Arabic shaping (`src/sme/reports/writers/pdf`) |
| Charts | Recharts 3 |
| Icons | lucide-react |
| AI | Gemini or OpenAI via REST, only through `src/ai/orchestrator.ts` |
| Tests | Vitest (unit), pgTAP (`supabase test db`), Playwright (e2e) |

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx                # Arabic-first root, CRM metadata
│   ├── page.tsx                  # 307 → /crm/dashboard
│   ├── login/ signup/ forgot-password/ reset-password/ auth/callback/
│   ├── (crm)/crm/                # All CRM pages (AuthGuard + OrgGuard + CRM shell)
│   │   ├── setup/                # Organization setup (exempt from OrgGuard)
│   │   ├── invite/[token]/       # Accept an invitation (exempt from OrgGuard)
│   │   └── settings/security|preferences|team|...
│   └── api/
│       ├── crm/v1/               # Public API (API keys; service role + explicit org_id filters)
│       ├── crm/whatsapp/         # User-facing routes (caller's JWT)
│       ├── billing/              # Caller's JWT; owner/admin only
│       ├── cron/, automation/    # Workers: CRON_SECRET + service role
│       └── webhooks/, tracking/  # Inbound webhooks and email tracking
├── ai/                           # orchestrator.ts (the only door to providers), agents, providers
├── automation/                   # Workflow engine, actions, outbox worker
├── components/                   # crm/* feature components, ui/* primitives
├── crm/                          # CRM domain modules (search, scoring, documents, verticals…)
├── integrations/                 # OAuth adapters, sync engine, privacy
├── lib/                          # supabaseClient (browser), supabaseServer (server), serverAuth,
│                                 # apiError (R13), routes, utils, constants
├── messages/{ar,en}/             # i18n by domain, flattened as `<domain>.<key>`
├── middleware/                   # apiAuth (public API keys), planGate
├── sme/                          # SME Jordan modules (see below)
├── store/                        # Zustand + context providers
└── types/
supabase/
├── migrations/                   # Timestamped; 20261118000000_crm_baseline.sql is the baseline
├── tests/                        # pgTAP
└── seed.sql                      # Local development only
tests/e2e/                        # Playwright
docs/                             # Playbook, blueprint, handoff, port ledger, archive
```

---

## Core Conventions

### 1. Arabic-first, RTL-first
- Every user-facing string exists in both `src/messages/ar/*` and `src/messages/en/*`.
- Use logical CSS properties (`padding-inline-start`, `inset-inline-end`), never left/right.
- Arabic UI numbers use `ar-JO-u-nu-arab` (Arabic-Indic digits, Gregorian calendar); English uses `en-JO`. Use `INTL_LOCALE` from `src/sme/money`.
- Test every UI change in Arabic RTL and English LTR, including at phone width.

### 2. i18n keys by domain
- Keys live in `src/messages/{en,ar}/<domain>.ts` and are flattened as `<domain>.<key>`. Do not repeat the domain inside the key.
- `node scripts/check-i18n.mjs` (`npm run check:i18n`) fails when a used id is missing in either locale.

### 3. One door to the LLM
- All LLM calls go through `src/ai/orchestrator.ts`. Nothing outside `src/ai/` imports `src/ai/providers/*`; ESLint enforces this for static and dynamic imports.
- Change providers in `src/ai/config.ts` only.

### 4. Supabase is the source of truth, and tenancy is enforced in the database
- Every tenant table has `org_id` and RLS. Stores are caches.
- Browser code uses `src/lib/supabaseClient.ts`.
- Routes a signed-in user calls use `requireUser()` from `src/lib/serverAuth.ts`, which returns a client acting as that user.
- The service-role client (`src/lib/supabaseServer.ts`, `server-only`) is allowed only in cron and outbox workers, webhook handlers and the public API after key resolution. Every query through it filters by `org_id` explicitly.
- Joining an organization happens only through `org_invite` / `org_accept_invitation`. Direct inserts into `org_members` are denied. Nobody grants a role above their own.

### 5. Money
- Money is `bigint` minor units plus an ISO 4217 code (`src/sme/money`). JOD has 3 decimals. Never do money arithmetic with JS `number`.
- Legacy CRM numeric columns reach the client as numbers. Format them with `useFormatCurrency()` / `formatCurrency()`, which convert through `fromMajorNumber` and `formatMoney`.

### 6. Outbound messages need a person
- Automation never messages customers by itself. Email and WhatsApp actions always create drafts. Slack and webhooks create drafts when the workflow requires confirmation or the trigger is SME-originated.
- Drafts are approved in the Outbox (`/crm/automation`) and delivered by the worker.

### 7. Errors
- New routes return `errorResponse(code)` from `src/lib/apiError.ts`: `{ error: { code, message_en, message_ar, details? } }`, codes from playbook Appendix C. No stack traces leave the server.

### 8. Migrations
- `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`. Never edit a merged migration.
- Every new tenant table gets RLS in the same migration and an Org B fixture in `supabase/tests/000_baseline.sql`. That test fails until the fixture exists.

### 9. Comments policy
Comments explain non-obvious intent or reasoning only. Do not narrate what the code does.

---

## Design System

Tokens are CSS variables in `src/app/globals.css` (`--ds-*`), with light and dark themes via `data-theme`.

| Token | Light value | Usage |
|---|---|---|
| `--ds-bg-page` | `#F5F0EB` | Page background |
| `--ds-bg-card` | `#FFFFFF` | Card surface |
| `--ds-primary` | `#2D6A4F` | Buttons, active states |
| `--ds-bg-tinted` | `#F0F7F4` | Tinted backgrounds |
| `--ds-accent-gold` | `#D97706` | Achievements and badges only |

**Purple, violet and indigo are not part of the design system. Do not introduce them.**

---

## Commands

```bash
npm run dev            # Development server (AuthGuard bypasses its check in development)
npm run build          # Production build (needs NEXT_PUBLIC_SUPABASE_* set)
npm run lint           # ESLint
npx tsc --noEmit       # Type check
npm run test:unit      # Vitest
npm run check:i18n     # Message ids exist in both locales
supabase start         # Local Supabase (Docker); prints URL and keys for .env.local
supabase db reset      # Re-apply migrations and seed.sql
supabase test db       # pgTAP
npm test               # Playwright (BASE_URL, .env.test.local; expects the local seed)
```

Seeded local users (password `Passw0rd!local`): `owner.a@example.test` (Org A owner), `owner.b@example.test` (Org B owner), `no.org@example.test`, `join.me@example.test`.

---

## Branches and Deployment

- `main` deploys to production. Feature work goes on a branch, one playbook prompt per branch (`sme/<prompt-id>-<slug>`), merged by pull request after review.
- Vercel needs every variable in `.env.example` that the deployed features use. `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are required.

---

## Pages

| Route | Description |
|---|---|
| `/crm/dashboard` | KPIs, recent activity, at-risk deals |
| `/crm` | Pipeline board |
| `/crm/contacts`, `/crm/contacts/[id]` | Contacts |
| `/crm/deals`, `/crm/deals/[id]` | Deals |
| `/crm/tasks` | Tasks and calendar |
| `/crm/reports` | Pipeline and rep reports |
| `/crm/automation` | Workflows, templates, execution log, Outbox |
| `/crm/documents` | Templates, quotes, proposals |
| `/crm/import` | Contact import |
| `/crm/settings/*` | Security (password, TOTP), preferences, team and invitations, pipeline, fields, audit, billing, integrations, health, API keys, verticals, WhatsApp |
| `/crm/setup` | Create an organization |
| `/crm/invite/[token]` | Accept an invitation |

---

## SME Section

The SME Jordan build is specified in **`docs/SME_JORDAN_CURSOR_PLAYBOOK.md`** (blueprint in `docs/blueprint/`). The blueprint decides product behaviour; the playbook decides implementation; this file decides conventions. When they conflict, or all are silent, stop and ask. Never act past a `HUMAN GATE`.

**Non-negotiable rules (playbook §2):**
- **Product.** Arabic first (R1). Design tokens only, no purple (R2). Every SME screen implements the eight states in `src/sme/ui/DataState.tsx`: loading, empty, partial data, validated, stale, regulatory review needed, permission denied, processing failure (R3). Every material number shows its basis, as-of time and data quality, and links to a drill-down (R4).
- **Money and ledger.** bigint minor units; round once, half away from zero, recorded in the trace (R5). Posted ledger rows are append-only; corrections are reversals enforced by the database (R6). Invoices never change cash, and own-account transfers are never income or expense (R7). Every mutating endpoint requires `Idempotency-Key`, unique per organization (R8).
- **Security.** Server-side tenant isolation through `sme_has_perm()` on every SME table, export, search, storage path and assistant tool (R9). SME writes go through `sme_*` RPCs; no insert, update or delete policies for `authenticated` (R10). Service role only in workers and webhooks (R11). Postings, reversals, allocations, imports, grants, rule publications, exports and obligation completions write `sme_audit_events` in the same transaction (R12). Errors follow R13.
- **AI, rules, content.** One door to the LLM (R14). The AI never computes figures; every number comes from evidence with IDs (R15). Jordanian legal, tax, SSC, licensing and e-invoicing content comes only from published, reviewed, effective-dated rule versions. **Assistants must not write Jordanian legal content, rates, thresholds, fees or deadlines**; create `draft` placeholders for reviewers (R16). No external action without confirmation (R17). Uploaded document text is untrusted (R18). Calculators and engines are pure, versioned and tested (R19).
- **Engineering.** zod at every API boundary, no `any` (R20). Timestamped migrations with pgTAP, including an RLS test for a second organization (R21). SME code lives in `src/sme/<module>/{domain,server,api,ui}` and modules talk through exported services, not each other's tables (R22).

**Architecture (playbook §3):** browser → `/api/sme/v1/*` route handler (zod, `requireUser`, correlation id) → `sme_*` RPC with the user's JWT (permission check, rows, audit and outbox in one transaction). Reads go through RLS. The outbox worker `/api/cron/sme-outbox` (service role, `CRON_SECRET`) runs idempotent handlers. SME navigation (Finance, Business) shows only when the organization's country is `JO` and the plan includes `sme_suite`.

**Already in place:** `src/sme/money` (W0-08), the forecast engine core and report writers ported from the consumer app (W0-06, ledger in `docs/PORTED_FROM_CONSUMER.md`), the error contract (`src/lib/apiError.ts`), `requireUser` and `requireOrgPermission` (`src/lib/serverAuth.ts`), and outbound drafts (W0-10).

**Per-PR checklist (playbook §2.6):** lint and `tsc` pass; `npm run test:unit` passes and new pure logic has tests; `supabase db reset && supabase test db` passes and every new table has a second-organization RLS test; Playwright passes for affected flows; `npm run check:i18n` passes; Arabic RTL and English LTR screenshots attached; blueprint IDs listed and Appendix F updated; ports recorded in `docs/PORTED_FROM_CONSUMER.md`.
