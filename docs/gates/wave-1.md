# Wave 1 gates

The playbook (§5) requires every gate below to be signed and linked here before any SME
feature reaches production. Status as recorded; "open" means no sign-off yet.

| Gate | Owner | Status | Date | Notes |
| --- | --- | --- | --- | --- |
| G1 KPI definitions signed, including opening balances and missing periods | Finance lead | Open | | Data-quality thresholds `dq-proposal-2026-11` (W2-07) await this sign-off. |
| G2 Jordan tax, legal and SSC reviewer contracted; refresh cadence and incident process agreed | Product owner | Open | | Lookup lists from W2-03 are seeded as `needs_review`. |
| G3 Data map approved under Jordan's PDP law | Security lead and counsel | Open | | Consent document versions are placeholders (`draft-2026-11`). |
| G4 AI and document-extraction hosting decided | Security lead | Open | | |
| G5 First paid segment and minimum bookkeeping maturity | Product owner | Open | | |
| G6 Receivables register vs official invoices confirmed | Product owner | **Confirmed** | 19 Nov 2026 | The receivables register records invoices issued elsewhere. It is not a tax invoice and is not submitted to JoFotara. W3a-02 copy and labels follow this. |
| G7 Malware scanning approach for uploads chosen | Security lead | Open | | Blocks W2-06 and W3b-09 in production. |
| G8 Backup, RPO ≤ 24 h, RTO ≤ 8 h confirmed with a tested restore | Engineering lead | Open | | |
