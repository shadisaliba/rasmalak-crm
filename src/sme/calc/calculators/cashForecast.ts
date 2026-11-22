import { z } from 'zod';
import { defineCalculator } from '../core/define';
import type { CalcOutcome } from '../core/types';

// F4.01: an adapter over the thirteen-week forecast (W3a-07). Until that engine exists the
// catalogue lists it as unavailable and runCalculation stops before compute.
export const CASH_FORECAST_VERSION = '1.0.0';

const input = z.object({});
type Input = z.infer<typeof input>;

function compute(): CalcOutcome {
  return { ok: false, errors: [{ code: 'DATA_INCOMPLETE', messageKey: 'calc.cash_forecast.unavailable' }] };
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
  unavailableReasonKey: 'calc.cash_forecast.unavailable',
  compute,
});
