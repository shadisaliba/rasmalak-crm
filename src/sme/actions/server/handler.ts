import 'server-only';
import { serviceDb } from '@/lib/supabaseServer';
import type { OutboxEvent } from '@/sme/events/types';
import { evaluateActionsForOrg } from './evaluate';

/**
 * Re-evaluates the rules after a register, import or forecast change (W3a-09 step 3). An event is
 * skipped when an evaluation already ran after it was emitted.
 */
export async function handleActionInputChanged(event: OutboxEvent): Promise<void> {
  const db = serviceDb();
  const [{ data: last, error }, { data: org, error: orgError }] = await Promise.all([
    db.from('sme_action_evaluations').select('evaluated_at').eq('org_id', event.orgId).maybeSingle(),
    db.from('organizations').select('country').eq('id', event.orgId).maybeSingle(),
  ]);
  if (error) throw new Error(`evaluation lookup failed: ${error.message}`);
  if (orgError) throw new Error(`organization lookup failed: ${orgError.message}`);
  if (org?.country !== 'JO') return;
  if (event.createdAt && last?.evaluated_at && last.evaluated_at >= event.createdAt) return;
  await evaluateActionsForOrg(event.orgId);
}
