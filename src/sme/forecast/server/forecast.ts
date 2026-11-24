import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SmeError, fromDbError } from '@/sme/api/errors';
import { assessDataQuality, type DataQualityResult } from '@/sme/kpi/domain/dataQuality';
import { canonicalInputs, runForecast } from '../domain/engine';
import { ENGINE_VERSION, toWire, type ForecastInputs, type ForecastResult, type ScenarioOverride, type Wire } from '../domain/types';
import { scenarioOverrides } from '../api/schemas';
import { loadForecastInputs } from './loadInputs';

export interface StoredForecast {
  run: { id: string; created_at: string; scenario_id: string | null; input_digest: string; engine_version: string; as_of: string };
  result: Wire<ForecastResult>;
  data_quality: DataQualityResult;
}

interface Prepared { inputs: ForecastInputs; overrides: ScenarioOverride[]; digest: string; scenarioId: string | null }

async function prepare(db: SupabaseClient, org: string, scenarioId: string | null): Promise<Prepared> {
  let overrides: ScenarioOverride[] = [];
  if (scenarioId) {
    const { data, error } = await db.from('sme_scenarios').select('overrides').eq('org_id', org).eq('id', scenarioId).eq('status', 'active').maybeSingle();
    if (error) throw fromDbError(error);
    if (!data) throw new SmeError('NOT_FOUND', { entity: 'scenario' });
    const parsed = scenarioOverrides.safeParse(data.overrides);
    if (!parsed.success) throw new SmeError('VALIDATION_FAILED', { field: 'overrides' });
    overrides = parsed.data;
  }
  const inputs = await loadForecastInputs(db, org);
  const digest = createHash('sha256').update(canonicalInputs(inputs, overrides)).digest('hex');
  return { inputs, overrides, digest, scenarioId };
}

async function storedRun(db: SupabaseClient, org: string, p: Prepared | null, scenarioId: string | null): Promise<StoredForecast | null> {
  let query = db.from('sme_forecast_runs').select('id, created_at, scenario_id, input_digest, engine_version, as_of, result, data_quality').eq('org_id', org);
  query = scenarioId ? query.eq('scenario_id', scenarioId) : query.is('scenario_id', null);
  if (p) query = query.eq('engine_version', ENGINE_VERSION).eq('input_digest', p.digest);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) return null;
  const { result, data_quality, ...run } = data as StoredForecast['run'] & { result: Wire<ForecastResult>; data_quality: DataQualityResult };
  return { run, result, data_quality };
}

async function dataQuality(db: SupabaseClient, org: string, today: string): Promise<DataQualityResult> {
  const { data, error } = await db.rpc('sme_data_quality_inputs', { p_org: org });
  if (error) throw fromDbError(error);
  const d = data as { accounts: Array<{ account_id: string; first_date: string | null; last_date: string | null; last_import_date: string | null }>; transaction_count: number; categorized_count: number; unresolved_import_rows: number };
  return assessDataQuality({
    today,
    accounts: d.accounts.map(a => ({ accountId: a.account_id, firstDate: a.first_date, lastDate: a.last_date, lastImportDate: a.last_import_date })),
    transactionCount: d.transaction_count, categorizedCount: d.categorized_count, unresolvedImportRows: d.unresolved_import_rows,
  });
}

/**
 * The latest stored run and whether it still matches today's inputs. Reads only; a stale or
 * missing run is recomputed by `recordForecast` (POST /forecasts).
 */
export async function latestForecast(db: SupabaseClient, org: string, scenarioId: string | null): Promise<{ forecast: StoredForecast | null; stale: boolean }> {
  const p = await prepare(db, org, scenarioId);
  const current = await storedRun(db, org, p, scenarioId);
  if (current) return { forecast: current, stale: false };
  return { forecast: await storedRun(db, org, null, scenarioId), stale: true };
}

/**
 * Computes a forecast and stores it, once per input digest. `worker` uses the service-role path
 * (outbox handler, rule R11); otherwise the caller's permissions apply in the database.
 */
export async function recordForecast(db: SupabaseClient, org: string, scenarioId: string | null, worker = false): Promise<StoredForecast> {
  const p = await prepare(db, org, scenarioId);
  const existing = await storedRun(db, org, p, scenarioId);
  if (existing) return existing;

  const result = runForecast(p.inputs, p.overrides);
  const quality = await dataQuality(db, org, p.inputs.asOf);
  const wire = toWire(result);
  const { data, error } = await db.rpc(worker ? 'sme_record_forecast_run_worker' : 'sme_record_forecast_run', {
    p_org: org,
    p_run: {
      scenario_id: scenarioId, engine_version: ENGINE_VERSION, as_of: p.inputs.asOf, input_digest: p.digest,
      assumptions: wire.assumptions, result: wire, data_quality: quality,
    },
  });
  if (error) throw fromDbError(error);
  const stored = data as { id: string; created_at: string };
  return {
    run: { id: stored.id, created_at: stored.created_at, scenario_id: scenarioId, input_digest: p.digest, engine_version: ENGINE_VERSION, as_of: p.inputs.asOf },
    result: wire,
    data_quality: quality,
  };
}
