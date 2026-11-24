import { orgIdFrom, parseQuery, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { listQuery } from '@/sme/actions/api/schemas';
import { evaluateActionsSoonIfStale } from '@/sme/actions/server/evaluate';

const SEVERITY = { critical: 0, warning: 1, info: 2 } as const;
const VIEW_STATUSES = { open: ['open'], snoozed: ['snoozed'], done: ['resolved', 'dismissed'] } as const;

// F1.11: the organization's actions the caller may see (RLS), most urgent first.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const query = parseQuery(request, listQuery);
  const [actions, evaluation, allowed] = await Promise.all([
    db.from('sme_actions')
      .select('id, rule_code, rule_version, subject_type, subject_id, severity, title_key, body_key, params, evidence, competency_tags, status, snooze_until, decided_at, decision_reason, crm_task_id, created_at, updated_at')
      .eq('org_id', org).in('status', [...VIEW_STATUSES[query.view]])
      .order(query.view === 'done' ? 'decided_at' : 'created_at', { ascending: false }).limit(query.limit),
    db.from('sme_action_evaluations').select('evaluated_at').eq('org_id', org).maybeSingle(),
    db.rpc('sme_has_perm', { p_org: org, p_perm: 'sme.ledger.read' }),
  ]);
  if (actions.error) throw fromDbError(actions.error);
  if (evaluation.error) throw fromDbError(evaluation.error);
  const evaluatedAt = (evaluation.data?.evaluated_at as string | undefined) ?? null;
  // Only a member who can read the ledger starts a re-evaluation; its result is org-wide.
  const checking = allowed.data === true ? await evaluateActionsSoonIfStale(org, evaluatedAt) : false;
  const items = (actions.data ?? []).sort((a, b) =>
    query.view === 'open' ? SEVERITY[a.severity as keyof typeof SEVERITY] - SEVERITY[b.severity as keyof typeof SEVERITY] : 0);
  return { body: { items, evaluated_at: evaluatedAt, checking } };
});
