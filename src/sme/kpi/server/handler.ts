import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import type { OutboxEvent } from '@/sme/events/types';
import { KPI_VERSION } from '../domain/summary';
import { currentMonth, refreshKpiSnapshot } from './summary';

/** Keeps this month's KPI snapshot current after ledger and register events (W3a-08 step 4). */
export async function handleKpiInputChanged(event: OutboxEvent): Promise<void> {
  const db = serviceDb();
  const period = currentMonth();
  const [{ data: org, error: orgError }, { data: snapshot, error }] = await Promise.all([
    db.from('organizations').select('country').eq('id', event.orgId).maybeSingle(),
    db.from('sme_kpi_snapshots').select('computed_at').eq('org_id', event.orgId).eq('period_key', `${period.from}_${period.to}`).eq('kpi_version', KPI_VERSION).maybeSingle(),
  ]);
  if (orgError) throw new Error(`organization lookup failed: ${orgError.message}`);
  if (error) throw new Error(`snapshot lookup failed: ${error.message}`);
  if (org?.country !== 'JO') return;
  if (event.createdAt && snapshot?.computed_at && snapshot.computed_at >= event.createdAt) return;
  await refreshKpiSnapshot(db, event.orgId, period);
}
