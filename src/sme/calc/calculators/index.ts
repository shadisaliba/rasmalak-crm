import type { RegisteredCalculator } from '../core/types';
import { loanAffordability } from './loanAffordability';
import { serviceHourlyRate } from './serviceHourlyRate';

/** Every calculator in the build. The catalogue orders them by CALCULATOR_CODES. */
export const CALCULATORS: RegisteredCalculator[] = [
  serviceHourlyRate,
  loanAffordability,
];
