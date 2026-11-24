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
| `src/lib/pdf/arabic.ts` | `720f174` | `src/sme/reports/writers/pdf/arabic.ts` | Shaping fixes (W3a-10): the isolated and final forms of waw, dal, thal, reh, zain and jeh were swapped, and a letter after a right-joining letter (alef, dal, reh…) wrongly joined to it. The consumer app has the same bugs | W0-06 |
| `src/lib/pdf/builder.ts` | `720f174` | `src/sme/reports/writers/pdf/builder.ts` | None | W0-06 |
| `src/lib/pdf/layout.ts` | `720f174` | `src/sme/reports/writers/pdf/layout.ts` | None; fonts still load from `public/fonts/` | W0-06 |
| `src/lib/pdf/ttf.ts` | `720f174` | `src/sme/reports/writers/pdf/ttf.ts` | None | W0-06 |
| `src/lib/pdf/writer.ts` | `720f174` | `src/sme/reports/writers/pdf/writer.ts` | None | W0-06 |
| `src/lib/pdf/__tests__/arabicShaper.test.ts` | `720f174` | `src/sme/reports/writers/pdf/__tests__/arabicShaper.test.ts` | Tests for the W3a-10 shaping fixes added | W0-06 |
| `src/lib/xlsx/builder.ts` | `720f174` | `src/sme/reports/writers/xlsx/builder.ts` | None (writer only; no SheetJS) | W0-06 |
| `src/lib/xlsx/xml.ts` | `720f174` | `src/sme/reports/writers/xlsx/xml.ts` | Style 7, a three-decimal number format for JOD amounts (W3a-10) | W0-06 |
| `src/lib/xlsx/zip.ts` | `720f174` | `src/sme/reports/writers/xlsx/zip.ts` | None (writer only; no SheetJS) | W0-06 |
| `vitest.config.ts` | `720f174` | `vitest.config.ts` | None | W0-06 |
| `src/calculators/simpleLoanCalculator.ts` | `720f174` | `src/sme/calc/calculators/loanAffordability.ts` | Copied unchanged to `src/sme/calc/calculators/ported/simpleLoanCalculator.ts` first, then rewritten and the copy removed. Kept: the reducing-balance instalment `M = P·r(1+r)^n / ((1+r)^n − 1)` (`P / n` at a zero rate) and the schedule loop with a last-payment adjustment. Changed: money is bigint fils and rates are decimal.js instead of JS `number`; each figure is rounded once, half away from zero, with a trace note instead of `round2`; the last payment clears the exact remaining balance instead of stopping at a 0.01 tolerance; payment dates dropped. Added: flat-rate basis, fixed or percentage fees, quarterly payments, the effective annual rate by Newton–Raphson IRR, and the +2 / +4 point stress table | W3a-06 |
| `src/types/course.ts` | `720f174` | `src/sme/content/types.ts` | None | W3b-02 |
| `src/components/ui/MarkdownText.tsx` | `720f174` | `src/sme/content/ui/MarkdownText.tsx` | None | W3b-02 |
| `src/components/courses/CourseSection.tsx` | `720f174` | `src/sme/content/ui/CourseSection.tsx` | Import paths; passes a quiz score callback to the quiz | W3b-02 |
| `src/components/courses/blocks/{ActionPromptBlock,BulletListBlock,CheckpointBlock,ComparisonBlock,ExampleBlock,KeyInsightBlock,TextBlock}.tsx`, `blocks/index.ts` | `720f174` | `src/sme/content/ui/blocks/` | Import paths only | W3b-02 |
| `src/components/courses/blocks/CheckpointQuiz.tsx` | `720f174` | `src/sme/content/ui/blocks/CheckpointQuiz.tsx` | Import paths; quiz is skippable and reports a score kept apart from completion; white text uses `--ds-on-primary` | W3b-02 |
| `src/messages/{en,ar}/learn.ts` (`course.checkpoint_title`, `course.quiz_*`) | `720f174` | `src/messages/{en,ar}/learn.ts` | `course.quiz_passed_sub` reworded (passing no longer completes anything); skip texts added | W3b-02 |
| `src/components/courses/{CourseContent,CourseHero,CourseSidebar}.tsx` | `720f174` | — (reference only) | Not copied: they page through a whole course with the consumer progress store and quiz gating. Here a lesson is the unit; `src/sme/content/ui/LessonPage.tsx` is new code that follows them | W3b-02 |
| `src/data/courses/{sme_financial_management,taxes_and_legal}{,_intermediate,_advanced}_{en,ar}.json` | `720f174` | Database drafts via `scripts/import-consumer-courses.mjs` (not committed) | One draft per lesson and language; tax and legal marked regulated; three near-duplicate pairs and 16 empty Arabic paragraphs (dropped) noted in `change_note` | W3b-02 |
