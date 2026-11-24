# Decisions log

Decisions the playbook leaves to a person, recorded with who made them and when.

| Date | Decision | Decided by | Playbook reference |
| --- | --- | --- | --- |
| 18 Nov 2026 | CRM Supabase project region: **Frankfurt (eu-central-1)**. Counsel should still confirm cross-border transfer terms under Jordan's PDP law before the pilot (gate G3). | Product owner | W0-03 HUMAN GATE, blueprint §14 decision 2 |
| 18 Nov 2026 | CRM repository: private `shadisaliba/rasmalak-crm`. | Product owner | W0-01 HUMAN GATE |
| 18 Nov 2026 | Wave 0 merged to `main` before pull-request review, to host quickly; Wave 0 branches stay pushed for review after the fact. Later prompts return to one branch and one PR each. | Product owner | Playbook "How to use this file" §3 |
| 19 Nov 2026 | Gate G6 confirmed: the receivables register records invoices issued elsewhere, not tax invoices, and nothing is submitted to JoFotara (see `wave-1.md`). | Product owner | W3a-02, §5 G6 |
| 19 Nov 2026 | Wave 2, W3a-01 to W3a-04 and two UI changes pushed to `main` before pull-request review; their branches stay pushed for review after the fact. Production remains off: the Vercel project has no Git link and no production deployment is made. | Product owner | Playbook "How to use this file" §3 |
| 19 Nov 2026 | Hosted CRM database: new Supabase project `mtyexyaoojtsgwaisnvt` in **Frankfurt (eu-central-1)**, as decided on 18 Nov. The earlier Tokyo project (`siduwsxrnosplfguwnui`) was deleted to stay within the free-plan project limit. Migrations applied without seed data; the database password is kept in the macOS Keychain item "Rasmalak CRM Supabase DB". | Product owner | W0-03, blueprint §14 decision 2 |
| 19 Nov 2026 | Vercel Hobby plan: every cron in `vercel.json` runs once a day. Crons run only in production, which is off. Before production, upgrade to Pro and restore the 5-minute outbox, email sync and automation schedules, or accept daily runs. | Product owner | Deployment |
| 22 Nov 2026 | The product is the **SME platform** for running a small business (Money, Sales, Tools, Learn, Ask, Compliance), not a CRM with an SME add-on. The CRM built earlier stays inside as the Sales section. Every Jordanian organization gets the SME modules whatever its plan; the `sme_suite` plan feature is retired (migration `20261122000000_sme_enabled_for_jordan.sql`). New organizations default to Jordan and JOD. Tools (W3a-05, W3a-06) and Learn (W3b-01, W3b-02) are built next, ahead of the rest of Wave 3a. Product name still to be chosen. | Product owner | Playbook §1.2, §1.3 Pricing |
