# Decisions log

Decisions the playbook leaves to a person, recorded with who made them and when.

| Date | Decision | Decided by | Playbook reference |
| --- | --- | --- | --- |
| 18 Nov 2026 | CRM Supabase project region: **Frankfurt (eu-central-1)**. Counsel should still confirm cross-border transfer terms under Jordan's PDP law before the pilot (gate G3). | Product owner | W0-03 HUMAN GATE, blueprint §14 decision 2 |
| 18 Nov 2026 | CRM repository: private `shadisaliba/rasmalak-crm`. | Product owner | W0-01 HUMAN GATE |
| 18 Nov 2026 | Wave 0 merged to `main` before pull-request review, to host quickly; Wave 0 branches stay pushed for review after the fact. Later prompts return to one branch and one PR each. | Product owner | Playbook "How to use this file" §3 |
| 19 Nov 2026 | Gate G6 confirmed: the receivables register records invoices issued elsewhere, not tax invoices, and nothing is submitted to JoFotara (see `wave-1.md`). | Product owner | W3a-02, §5 G6 |
| 19 Nov 2026 | Wave 2, W3a-01 to W3a-04 and two UI changes pushed to `main` before pull-request review; their branches stay pushed for review after the fact. Production remains off: the Vercel project has no Git link and no production deployment is made. | Product owner | Playbook "How to use this file" §3 |
