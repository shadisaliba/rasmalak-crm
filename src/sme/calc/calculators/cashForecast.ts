import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcOutcome } from '../core/types';

// F4.01: a view of the thirteen-week forecast (W3a-07). The forecast needs the organization's
// ledger and registers, so the tool opens FIN-05 rather than computing its own figures; the
// numbers are then the same by construction.
export const CASH_FORECAST_VERSION = '1.0.0';

const input = z.object({});
type Input = z.infer<typeof input>;

function compute(): CalcOutcome {
  return { ok: false, errors: [{ code: 'DATA_INCOMPLETE', messageKey: 'calc.cash_forecast.onScreen' }] };
}

export const cashForecast = defineCalculator<Input>({
  code: 'cash_forecast',
  version: CASH_FORECAST_VERSION,
  blueprintId: 'F4.01',
  group: 'cash_planning',
  complexity: 'advanced',
  input,
  example: {},
  fields: [],
  screen: '/crm/money/forecast',
  compute,
});
