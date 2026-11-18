# Files ported from the consumer app

Every file copied from the consumer Rasmalak repository is listed here, because the copies
will not stay in sync on their own. Donor: `Shadimasarweh/Rasmalak` branch `main`.

| Donor path | Donor commit | Destination | Changes after copy | Prompt |
| --- | --- | --- | --- | --- |
| `src/lib/supabaseServer.ts` | `720f174` | `src/lib/supabaseServer.ts` | Service client throws without `SUPABASE_SERVICE_ROLE_KEY` (no anon fallback); `server-only` guard; `serviceDb` alias | W0-05 |
