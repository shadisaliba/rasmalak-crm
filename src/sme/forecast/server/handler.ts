import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import type { OutboxEvent } from '@/sme/events/types';
import { recordForecast } from './forecast';

/**
 * Recomputes the baseline forecast after an input changes (W3a-07 step 6). A burst of events,
 * such as one import posting hundreds of lines, yields one run: an event is skipped when a
 * baseline run was stored after it, and runs are stored once per input digest anyway.
 */
export async function handleForecastInputChanged(event: OutboxEvent): Promise<void> {
  const db = serviceDb();
  if (event.createdAt) {
    const { data, error } = await db.from('sme_forecast_runs').select('id')
      .eq('org_id', event.orgId).is('scenario_id', null).gte('created_at', event.createdAt).limit(1);
    if (error) throw new Error(`forecast run lookup failed: ${error.message}`);
    if (data?.length) return;
  }
  const { data: org, error } = await db.from('organizations').select('country').eq('id', event.orgId).maybeSingle();
  if (error) throw new Error(`organization lookup failed: ${error.message}`);
  if (org?.country !== 'JO') return;
  await recordForecast(db, event.orgId, null, true);
}
