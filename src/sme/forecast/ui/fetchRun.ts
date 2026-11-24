'use client';

import { smeApi, type SmeResult } from '@/sme/api/client';
import type { ForecastRun } from '../api/types';

/** The stored run if it matches today's inputs; otherwise recompute, falling back to the stale run. */
export async function fetchRun(orgId: string, scenarioId: string | null): Promise<SmeResult<{ run: ForecastRun; stale: boolean }>> {
  const latest = await smeApi<{ forecast: ForecastRun | null; stale: boolean }>(`forecasts/latest${scenarioId ? `?scenario_id=${scenarioId}` : ''}`, { orgId });
  if (!latest.ok) return latest;
  if (latest.data.forecast && !latest.data.stale) return { ok: true, data: { run: latest.data.forecast, stale: false } };
  const fresh = await smeApi<ForecastRun>('forecasts', { orgId, method: 'POST', body: { scenario_id: scenarioId } });
  if (fresh.ok) return { ok: true, data: { run: fresh.data, stale: false } };
  return latest.data.forecast ? { ok: true, data: { run: latest.data.forecast, stale: true } } : fresh;
}
