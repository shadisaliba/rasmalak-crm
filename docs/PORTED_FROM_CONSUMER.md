# Files ported from the consumer app

Every file copied from the consumer Rasmalak repository is listed here, because the copies
will not stay in sync on their own. Donor: `Shadimasarweh/Rasmalak` branch `main`.

| Donor path | Donor commit | Destination | Changes after copy | Prompt |
| --- | --- | --- | --- | --- |
| `src/lib/supabaseServer.ts` | `720f174` | `src/lib/supabaseServer.ts` | Service client throws without `SUPABASE_SERVICE_ROLE_KEY` (no anon fallback); `server-only` guard; `serviceDb` alias | W0-05 |
| `src/ai/deterministic/stats.ts` | `720f174` | `src/sme/forecast/engine-core/stats.ts` | None | W0-06 |
| `src/ai/deterministic/dates.ts` | `720f174` | `src/sme/forecast/engine-core/dates.ts` | None | W0-06 |
| `src/ai/deterministic/engineTypes.ts` | `720f174` | `src/sme/forecast/engine-core/engineTypes.ts` | `@/lib/cycles` import made relative | W0-06 |
| `src/ai/deterministic/recurringSeries.ts` | `720f174` | `src/sme/forecast/engine-core/recurringSeries.ts` | None | W0-06 |
| `src/ai/deterministic/categoryBaselines.ts` | `720f174` | `src/sme/forecast/engine-core/categoryBaselines.ts` | None | W0-06 |
| `src/ai/deterministic/cashflowForecast.ts` | `720f174` | `src/sme/forecast/engine-core/cashflowForecast.ts` | `@/lib/cycles` import made relative | W0-06 |
| `src/ai/deterministic/goalRisk.ts` | `720f174` | `src/sme/forecast/engine-core/goalRisk.ts` | None | W0-06 |
| `src/ai/deterministic/stats.test.ts` | `720f174` | `src/sme/forecast/engine-core/stats.test.ts` | None | W0-06 |
| `src/ai/deterministic/recurringSeries.test.ts` | `720f174` | `src/sme/forecast/engine-core/recurringSeries.test.ts` | None | W0-06 |
| `src/ai/deterministic/categoryBaselines.test.ts` | `720f174` | `src/sme/forecast/engine-core/categoryBaselines.test.ts` | `@/lib/cycles` import made relative | W0-06 |
| `src/ai/deterministic/cashflowForecast.test.ts` | `720f174` | `src/sme/forecast/engine-core/cashflowForecast.test.ts` | `@/lib/cycles` import made relative | W0-06 |
| `src/ai/deterministic/goalRisk.test.ts` | `720f174` | `src/sme/forecast/engine-core/goalRisk.test.ts` | None | W0-06 |
| `src/ai/deterministic/fixtures.ts` | `720f174` | `src/sme/forecast/engine-core/fixtures.ts` | `@/lib/cycles` import made relative | W0-06 |
| `src/lib/cycles.ts` | `720f174` | `src/sme/forecast/engine-core/cycles.ts` | None | W0-06 |
| `src/lib/cycles.test.ts` | `720f174` | `src/sme/forecast/engine-core/cycles.test.ts` | None | W0-06 |
| `src/lib/pdf/arabic.ts` | `720f174` | `src/sme/reports/writers/pdf/arabic.ts` | None | W0-06 |
| `src/lib/pdf/builder.ts` | `720f174` | `src/sme/reports/writers/pdf/builder.ts` | None | W0-06 |
| `src/lib/pdf/layout.ts` | `720f174` | `src/sme/reports/writers/pdf/layout.ts` | None; fonts still load from `public/fonts/` | W0-06 |
| `src/lib/pdf/ttf.ts` | `720f174` | `src/sme/reports/writers/pdf/ttf.ts` | None | W0-06 |
| `src/lib/pdf/writer.ts` | `720f174` | `src/sme/reports/writers/pdf/writer.ts` | None | W0-06 |
| `src/lib/pdf/__tests__/arabicShaper.test.ts` | `720f174` | `src/sme/reports/writers/pdf/__tests__/arabicShaper.test.ts` | None | W0-06 |
| `src/lib/xlsx/builder.ts` | `720f174` | `src/sme/reports/writers/xlsx/builder.ts` | None (writer only; no SheetJS) | W0-06 |
| `src/lib/xlsx/xml.ts` | `720f174` | `src/sme/reports/writers/xlsx/xml.ts` | None (writer only; no SheetJS) | W0-06 |
| `src/lib/xlsx/zip.ts` | `720f174` | `src/sme/reports/writers/xlsx/zip.ts` | None (writer only; no SheetJS) | W0-06 |
| `vitest.config.ts` | `720f174` | `vitest.config.ts` | None | W0-06 |
