import type { OutboxEvent, SmeEventType } from '../types';
import { handleImportParseRequested } from '@/sme/imports/server/parseHandler';
import { handleForecastInputChanged } from '@/sme/forecast/server/handler';
import { handleActionInputChanged } from '@/sme/actions/server/handler';
import { handleKpiInputChanged } from '@/sme/kpi/server/handler';

export type EventHandler = (event: OutboxEvent) => Promise<void>;

// Events are emitted from the prompt that introduces them; their consumers arrive in later
// prompts (Appendix E). Until then they are acknowledged so the outbox does not back up.
const acknowledge: EventHandler = async () => {};

// The forecast first: if it changes, ForecastRecalculated evaluates the actions again with it.
const forecastThenActions: EventHandler = async event => {
  await handleForecastInputChanged(event);
  await handleActionInputChanged(event);
  await handleKpiInputChanged(event);
};

const forecastAndKpis: EventHandler = async event => {
  await handleForecastInputChanged(event);
  await handleKpiInputChanged(event);
};

export const EVENT_HANDLERS: Record<SmeEventType, EventHandler> = {
  BusinessProfileUpdated: acknowledge,
  RoleRevoked: acknowledge,
  AccountCreated: acknowledge,
  TransactionPosted: forecastAndKpis,
  TransactionReversed: forecastAndKpis,
  TransactionClassified: event => handleKpiInputChanged(event),
  ImportParseRequested: event => handleImportParseRequested(event),
  ImportCommitted: forecastThenActions,
  InvoiceStatusChanged: forecastThenActions,
  BillStatusChanged: forecastThenActions,
  ScheduledItemChanged: event => handleForecastInputChanged(event),
  ForecastRecalculated: event => handleActionInputChanged(event),
  RulePublished: acknowledge,
  ApplicabilityEvaluated: acknowledge,
  ObligationCreated: acknowledge,
  ObligationConfirmed: acknowledge,
  ObligationCompleted: acknowledge,
  LessonCompleted: acknowledge,
};
