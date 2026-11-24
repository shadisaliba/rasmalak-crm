import type { Rule, RuleCode } from '../domain/types';
import { receivableOverdue } from './receivableOverdue';
import { forecastShortfall } from './forecastShortfall';
import { payablesDueSoon } from './payablesDueSoon';
import { costSpike } from './costSpike';
import { staleAccountData } from './staleAccountData';
import { uncategorizedBacklog } from './uncategorizedBacklog';
import { concentrationRisk } from './concentrationRisk';

export const RULES: Record<RuleCode, Rule> = {
  receivable_overdue: receivableOverdue,
  forecast_shortfall: forecastShortfall,
  payables_due_soon: payablesDueSoon,
  cost_spike: costSpike,
  stale_account_data: staleAccountData,
  uncategorized_backlog: uncategorizedBacklog,
  concentration_risk: concentrationRisk,
};
