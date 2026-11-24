import { callRpc, idempotencyKeyFrom, orgIdFrom, parseBody, smeRoute } from '@/sme/api/route';
import { fromDbError } from '@/sme/api/errors';
import { RULES } from '@/sme/actions/rules';
import { RULE_CODES } from '@/sme/actions/domain/types';
import { settingsBody } from '@/sme/actions/api/schemas';

// Each rule with its defaults and the organization's own values over them.
export const GET = smeRoute(async ({ request, db }) => {
  const org = orgIdFrom(request);
  const { data, error } = await db.from('sme_action_settings').select('rule_code, enabled, params').eq('org_id', org);
  if (error) throw fromDbError(error);
  const own = new Map((data ?? []).map(r => [r.rule_code, r]));
  return {
    body: {
      rules: RULE_CODES.map(code => ({
        rule_code: code, version: RULES[code].version, defaults: RULES[code].defaults,
        enabled: own.get(code)?.enabled ?? true, params: { ...RULES[code].defaults, ...((own.get(code)?.params as Record<string, number>) ?? {}) },
      })),
    },
  };
});

export const POST = smeRoute(async ({ request, db, correlationId }) => {
  const org = orgIdFrom(request);
  const key = idempotencyKeyFrom(request);
  const body = await parseBody(request, settingsBody);
  const known = Object.keys(RULES[body.rule_code].defaults);
  const params = Object.fromEntries(Object.entries(body.params).filter(([k]) => known.includes(k)));
  const res = await callRpc(db, 'sme_set_action_settings', {
    p_org: org, p_rule_code: body.rule_code, p_enabled: body.enabled, p_params: params, p_correlation_id: correlationId, p_idem: key,
  });
  return { body: res };
});
