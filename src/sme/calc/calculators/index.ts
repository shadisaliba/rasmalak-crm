import type { RegisteredCalculator } from '../core/types';
import { breakEven } from './breakEven';
import { cashForecast } from './cashForecast';
import { employeeCost } from './employeeCost';
import { loanAffordability } from './loanAffordability';
import { marginMarkup } from './marginMarkup';
import { productPricing } from './productPricing';
import { serviceHourlyRate } from './serviceHourlyRate';
import { startupCost } from './startupCost';
import { workingCapital } from './workingCapital';

/** Every calculator in the build. The catalogue orders them by CALCULATOR_CODES. */
export const CALCULATORS: RegisteredCalculator[] = [
  serviceHourlyRate,
  cashForecast,
  breakEven,
  marginMarkup,
  workingCapital,
  startupCost,
  loanAffordability,
  productPricing,
  employeeCost,
];
