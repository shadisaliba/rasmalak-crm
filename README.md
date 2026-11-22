# Rasmalak SME platform

The business side of Rasmalak as its own product: an Arabic-first platform that helps small
businesses in Jordan run the business. Money (accounts, transactions, invoices, bills, cash
forecast), Sales (the CRM), Tools (business calculators), Learn (Jordan playbooks), Ask Rasmalak
(AI assistant) and Compliance. The product name is not chosen yet; "Rasmalak CRM" in the UI is a
placeholder.

- Product spec: [`docs/blueprint/`](docs/blueprint/)
- Build order: [`docs/SME_JORDAN_CURSOR_PLAYBOOK.md`](docs/SME_JORDAN_CURSOR_PLAYBOOK.md)
- Conventions and architecture: [`CLAUDE.md`](CLAUDE.md)
- Decisions and sign-off gates: [`docs/gates/`](docs/gates/)

## Local development

Requires Node 20+, Docker and the Supabase CLI.

```bash
npm ci
supabase start                 # prints the local API URL, anon key and service role key
cp .env.example .env.local     # fill in NEXT_PUBLIC_SUPABASE_*, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
supabase db reset              # applies migrations and supabase/seed.sql
npm run dev
```

Sign in as `owner.a@example.test` with password `Passw0rd!local` (local seed only).

## Checks

```bash
npm run lint && npx tsc --noEmit
npm run test:unit
npm run check:i18n
supabase test db
npm run build && npx next start -p 3100 &
BASE_URL=http://localhost:3100 npm test   # Playwright; needs .env.test.local (see .env.example)
```
