// Domain events carried by sme_outbox (playbook Appendix E). Payloads hold ids and small facts,
// never personal data beyond what a handler needs to find its rows.

export interface SmeEventPayloads {
  BusinessProfileUpdated: { changed: string[]; profileVersion: number };
  RoleRevoked: { userId: string };
  AccountCreated: { accountId: string };
  TransactionPosted: { transactionId: string; accountId: string };
  TransactionReversed: { transactionId: string; reversalId: string };
  TransactionClassified: { transactionId: string; classificationId: string };
  ImportParseRequested: { batchId: string };
  ImportCommitted: { batchId: string; accountId: string; posted: number };
  InvoiceStatusChanged: { invoiceId: string; status: string };
  BillStatusChanged: { billId: string; status: string };
  ScheduledItemChanged: { itemId: string };
  ForecastRecalculated: { runId: string };
  RulePublished: { ruleVersionId: string; topicId: string };
  ApplicabilityEvaluated: { evaluationId: string; ruleVersionId: string; result: string };
  ObligationCreated: { obligationId: string };
  ObligationConfirmed: { obligationId: string };
  ObligationCompleted: { obligationId: string };
  LessonCompleted: { itemId: string; userId: string };
}

export type SmeEventType = keyof SmeEventPayloads;

export const SME_EVENT_TYPES = [
  'BusinessProfileUpdated', 'RoleRevoked', 'AccountCreated', 'TransactionPosted', 'TransactionReversed',
  'TransactionClassified', 'ImportParseRequested', 'ImportCommitted', 'InvoiceStatusChanged', 'BillStatusChanged',
  'ScheduledItemChanged', 'ForecastRecalculated', 'RulePublished', 'ApplicabilityEvaluated', 'ObligationCreated',
  'ObligationConfirmed', 'ObligationCompleted', 'LessonCompleted',
] as const satisfies readonly SmeEventType[];

export interface OutboxEvent<T extends SmeEventType = SmeEventType> {
  id: number;
  orgId: string;
  eventType: T;
  payload: SmeEventPayloads[T];
  attempts: number;
}

export function isSmeEventType(value: string): value is SmeEventType {
  return (SME_EVENT_TYPES as readonly string[]).includes(value);
}
