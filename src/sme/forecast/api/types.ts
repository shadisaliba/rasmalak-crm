import type { DataQualityResult } from '@/sme/kpi/domain/dataQuality';
import type { ForecastResult, ScenarioOverride, Wire } from '../domain/types';

/** A stored run as the forecast routes return it. */
export interface ForecastRun {
  run: { id: string; created_at: string; scenario_id: string | null; input_digest: string; engine_version: string; as_of: string };
  result: Wire<ForecastResult>;
  data_quality: DataQualityResult;
}

export interface ScheduledItemRow {
  id: string;
  label: string;
  direction: 'in' | 'out';
  amount_minor: string;
  start_date: string;
  recurrence: 'none' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  end_date: string | null;
  category_id: string | null;
  source: 'owner_entered' | 'detected_confirmed';
  series_key: string | null;
  is_estimate: boolean;
}

export interface ScenarioRow { id: string; name: string; overrides: ScenarioOverride[] }
