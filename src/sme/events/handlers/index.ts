import type { OutboxEvent, SmeEventType } from '../types';
import { handleImportParseRequested } from '@/sme/imports/server/parseHandler';

export type EventHandler = (event: OutboxEvent) => Promise<void>;

// Events are emitted from the prompt that introduces them; their consumers arrive in later
// prompts (Appendix E). Until then they are acknowledged so the outbox does not back up.
const acknowledge: EventHandler = async () => {};

export const EVENT_HANDLERS: Record<SmeEventType, EventHandler> = {
  BusinessProfileUpdated: acknowledge,
  RoleRevoked: acknowledge,
  AccountCreated: acknowledge,
  TransactionPosted: acknowledge,
  TransactionReversed: acknowledge,
  TransactionClassified: acknowledge,
  ImportParseRequested: event => handleImportParseRequested(event),
  ImportCommitted: acknowledge,
  InvoiceStatusChanged: acknowledge,
  BillStatusChanged: acknowledge,
  ScheduledItemChanged: acknowledge,
  ForecastRecalculated: acknowledge,
  RulePublished: acknowledge,
  ApplicabilityEvaluated: acknowledge,
  ObligationCreated: acknowledge,
  ObligationConfirmed: acknowledge,
  ObligationCompleted: acknowledge,
  LessonCompleted: acknowledge,
};
