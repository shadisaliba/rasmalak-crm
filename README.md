# Rasmalak CRM

Arabic-first CRM for small businesses in the MENA region, with the SME Jordan financial
intelligence build in progress. Conventions and architecture: [`CLAUDE.md`](CLAUDE.md).
SME build plan: [`docs/SME_JORDAN_CURSOR_PLAYBOOK.md`](docs/SME_JORDAN_CURSOR_PLAYBOOK.md).

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
