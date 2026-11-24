import 'server-only';
import { after } from 'next/server';
import { createIntl, createIntlCache } from 'react-intl';
import { serviceDb } from '@/lib/supabaseServer';
import { todayInAmman } from '@/sme/ledger/domain/dates';
import { INTL_LOCALE, formatMoney, money, type UiLocale } from '@/sme/money';
import { processEvent } from '@/automation/engine';
import type { TriggerType } from '@/types/crm';
import enActions from '@/messages/en/actions';
import arActions from '@/messages/ar/actions';
import { evaluateRules } from '../domain/evaluate';
import { actionValues } from '../domain/text';
import { loadActionInputs, loadRuleSettings } from './loadInputs';

interface Opened { id: string; rule_code: string; severity: string; title_key: string; params: Record<string, unknown>; subject_type: string | null; subject_id: string | null }

// A page view re-evaluates at most this often; events and the daily cron always do.
const VIEW_REFRESH_MS = 30 * 60 * 1000;

const TRIGGERS: Record<string, { type: TriggerType; entity: 'invoice' | 'bill' | 'forecast' }> = {
  receivable_overdue: { type: 'sme_invoice_overdue', entity: 'invoice' },
  forecast_shortfall: { type: 'sme_forecast_shortfall', entity: 'forecast' },
  payables_due_soon: { type: 'sme_bill_due', entity: 'bill' },
};

/**
 * Evaluates every rule for one organization and syncs the result (worker path, service role,
 * rule R11). Returns how many actions opened and resolved.
 */
export async function evaluateActionsForOrg(org: string, today: string = todayInAmman()): Promise<{ opened: number; resolved: number }> {
  const db = serviceDb();
  const [inputs, settings] = await Promise.all([loadActionInputs(db, org, today), loadRuleSettings(db, org)]);
  const evaluation = evaluateRules(inputs, settings);
  const { data, error } = await db.rpc('sme_sync_actions_worker', {
    p_org: org, p_rule_codes: evaluation.ruleCodes, p_actions: evaluation.actions, p_rule_versions: evaluation.ruleVersions,
  });
  if (error) throw new Error(`action sync failed: ${error.message}`);
  const result = data as { opened: Opened[]; resolved: number };
  await notify(org, result.opened);
  for (const a of result.opened) {
    const trigger = TRIGGERS[a.rule_code];
    if (!trigger || !a.subject_id) continue;
    // Workflows on SME triggers always wait for a person (src/automation/actions.ts isSmeTrigger).
    await processEvent({ type: trigger.type, orgId: org, entityType: trigger.entity, entityId: a.subject_id, data: { ...a.params, action_id: a.id }, timestamp: new Date().toISOString() });
  }
  return { opened: result.opened.length, resolved: result.resolved };
}

/** Owners and admins hear about new urgent and soon items once; information items wait on screen. */
async function notify(org: string, opened: Opened[]): Promise<void> {
  const worth = opened.filter(a => a.severity !== 'info');
  if (!worth.length) return;
  const db = serviceDb();
  const [{ data: members, error }, { data: cats }] = await Promise.all([
    db.from('org_members').select('user_id').eq('org_id', org).in('role', ['owner', 'admin']),
    db.from('sme_categories').select('code, name_en, name_ar').or(`org_id.is.null,org_id.eq.${org}`),
  ]);
  if (error) throw new Error(`notification recipients failed: ${error.message}`);
  if (!members?.length) return;
  const text = (locale: UiLocale) => {
    const intl = createIntl({ locale: INTL_LOCALE[locale], messages: locale === 'ar' ? arActions : enActions }, createIntlCache());
    const dates = new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    return (a: Opened) => intl.formatMessage({ id: a.title_key.replace(/^actions\./, '') }, actionValues(a.params, {
      money: minor => formatMoney(money(BigInt(minor), 'JOD'), locale),
      date: iso => dates.format(new Date(`${iso}T00:00:00Z`)),
      number: n => intl.formatNumber(n),
      category: code => { const c = cats?.find(x => x.code === code); return c ? String(locale === 'ar' ? c.name_ar : c.name_en) : code; },
    }));
  };
  const en = text('en');
  const ar = text('ar');
  const rows = worth.flatMap(a => members.map(m => ({
    org_id: org, user_id: m.user_id, type: 'sme_action', title: en(a), title_ar: ar(a), entity_type: 'sme_action', entity_id: a.id,
  })));
  const { error: insertError } = await db.from('crm_notifications').insert(rows);
  if (insertError) throw new Error(`notifications failed: ${insertError.message}`);
}

/**
 * Re-evaluates after the response when the last evaluation is older than VIEW_REFRESH_MS, so the
 * screen stays current where crons do not run (previews). Returns whether a run was scheduled.
 */
export async function evaluateActionsSoonIfStale(org: string, lastEvaluatedAt: string | null): Promise<boolean> {
  if (lastEvaluatedAt && Date.now() - Date.parse(lastEvaluatedAt) < VIEW_REFRESH_MS) return false;
  after(async () => {
    try {
      await evaluateActionsForOrg(org);
    } catch (err) {
      console.error('[sme-actions] evaluation after request failed', err);
    }
  });
  return true;
}
