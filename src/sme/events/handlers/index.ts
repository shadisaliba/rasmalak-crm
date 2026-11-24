import type { OutboxEvent, SmeEventType } from '../types';
import { handleImportParseRequested } from '@/sme/imports/server/parseHandler';
import { handleForecastInputChanged } from '@/sme/forecast/server/handler';

export type EventHandler = (event: OutboxEvent) => Promise<void>;

// Events are emitted from the prompt that introduces them; their consumers arrive in later
// prompts (Appendix E). Until then they are acknowledged so the outbox does not back up.
const acknowledge: EventHandler = async () => {};

export const EVENT_HANDLERS: Record<SmeEventType, EventHandler> = {
  BusinessProfileUpdated: acknowledge,
  RoleRevoked: acknowledge,
  AccountCreated: acknowledge,
  TransactionPosted: event => handleForecastInputChanged(event),
  TransactionReversed: event => handleForecastInputChanged(event),
  TransactionClassified: acknowledge,
  ImportParseRequested: event => handleImportParseRequested(event),
  ImportCommitted: event => handleForecastInputChanged(event),
  InvoiceStatusChanged: event => handleForecastInputChanged(event),
  BillStatusChanged: event => handleForecastInputChanged(event),
  ScheduledItemChanged: event => handleForecastInputChanged(event),
  ForecastRecalculated: acknowledge,
  RulePublished: acknowledge,
  ApplicabilityEvaluated: acknowledge,
  ObligationCreated: acknowledge,
  ObligationConfirmed: acknowledge,
  ObligationCompleted: acknowledge,
  LessonCompleted: acknowledge,
};
