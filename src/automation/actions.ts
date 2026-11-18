/**
 * Automation Action Execution
 * Executes workflow actions: task creation, notifications, stage moves, etc.
 */

import { serviceDb } from '@/lib/supabaseServer';
import { postSlackMessage, postWebhook, webhookTargetError } from './outboundSenders';
import type { ActionType } from '@/types/crm';

export interface ActionContext {
  orgId: string;
  entityType: string;
  entityId: string;
  entityData: Record<string, unknown>;
  workflowId: string;
  userId?: string;
  /** Outbound actions become drafts that a person must approve (rule R17). */
  requiresConfirmation: boolean;
}

// Anything triggered by SME financial data always waits for a person.
export function isSmeTrigger(triggerType: string): boolean {
  return triggerType.startsWith('sme_') || triggerType.startsWith('sme.');
}

export interface ActionResult {
  success: boolean;
  actionType: ActionType;
  details?: Record<string, unknown>;
  error?: string;
}

/**
 * Execute a single workflow action.
 * Each action type has its own handler with Supabase calls wrapped in try/catch.
 */
export async function executeAction(
  action: { type: ActionType; config: Record<string, unknown> },
  context: ActionContext
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'create_task':
        return await createTask(action.config, context);

      case 'send_notification':
        return await sendNotification(action.config, context);

      case 'move_deal_stage':
        return await moveDealStage(action.config, context);

      case 'add_tag':
        return await addTag(action.config, context);

      case 'remove_tag':
        return await removeTag(action.config, context);

      case 'update_field':
        return await updateField(action.config, context);

      case 'send_email':
        return await sendEmail(action.config, context);

      case 'send_whatsapp':
        return await sendWhatsApp(action.config, context);

      case 'send_slack':
        return await sendSlack(action.config, context);

      case 'assign_to':
        return await assignTo(action.config, context);

      case 'wait':
        return await handleWait(action.config);

      case 'webhook':
        return await callWebhook(action.config, context);

      default:
        return { success: false, actionType: action.type, error: `Unknown action: ${action.type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, actionType: action.type, error: message };
  }
}

const TASK_LINK_COLUMN: Record<string, 'deal_id' | 'contact_id' | 'company_id'> = {
  deal: 'deal_id',
  contact: 'contact_id',
  company: 'company_id',
};

async function createTask(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  // Automated tasks are attributed to the workflow's creator, or else the organization's creator.
  let createdBy = ctx.userId ?? null;
  if (!createdBy) {
    const { data: org } = await serviceDb().from('organizations').select('created_by').eq('id', ctx.orgId).maybeSingle();
    createdBy = org?.created_by ?? null;
  }
  const linkColumn = TASK_LINK_COLUMN[ctx.entityType];

  const { error } = await serviceDb().from('crm_tasks').insert({
    org_id: ctx.orgId,
    title: resolveTemplate(config.title as string, ctx.entityData),
    description: resolveTemplate(config.description as string | undefined, ctx.entityData) ?? null,
    assigned_to: config.assignTo ?? ctx.userId ?? null,
    created_by: createdBy,
    ...(linkColumn ? { [linkColumn]: ctx.entityId } : {}),
    due_date: config.dueInDays
      ? new Date(Date.now() + Number(config.dueInDays) * 86400000).toISOString()
      : null,
    priority: config.priority ?? 'medium',
    status: 'pending',
  });

  if (error) return { success: false, actionType: 'create_task', error: error.message };
  return { success: true, actionType: 'create_task' };
}

async function sendNotification(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const recipients = resolveRecipients(config, ctx);
  if (recipients.length === 0) {
    return { success: true, actionType: 'send_notification', details: { recipientCount: 0 } };
  }

  const title = resolveTemplate(config.title as string, ctx.entityData);
  const body = resolveTemplate(config.body as string, ctx.entityData);

  // Batch insert all notifications in one query instead of N+1 loop
  const rows = recipients.map(userId => ({
    org_id: ctx.orgId,
    user_id: userId,
    title,
    body,
    type: config.notificationType ?? 'automation',
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
  }));

  const { error } = await serviceDb().from('crm_notifications').insert(rows);
  if (error) return { success: false, actionType: 'send_notification', error: error.message };

  return { success: true, actionType: 'send_notification', details: { recipientCount: recipients.length } };
}

async function moveDealStage(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  if (ctx.entityType !== 'deal') {
    return { success: false, actionType: 'move_deal_stage', error: 'Entity is not a deal' };
  }

  // The stage id comes from workflow configuration, so confirm it belongs to this organization.
  const { data: stage } = await serviceDb()
    .from('crm_deal_stages')
    .select('id')
    .eq('id', config.stageId as string)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (!stage) return { success: false, actionType: 'move_deal_stage', error: 'Stage not found in this organization' };

  const { error } = await serviceDb()
    .from('crm_deals')
    .update({ stage_id: config.stageId, updated_at: new Date().toISOString() })
    .eq('id', ctx.entityId)
    .eq('org_id', ctx.orgId);

  if (error) return { success: false, actionType: 'move_deal_stage', error: error.message };
  return { success: true, actionType: 'move_deal_stage', details: { newStageId: config.stageId } };
}

async function addTag(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const tag = config.tag as string;
  const table = ctx.entityType === 'contact' ? 'crm_contacts' : 'crm_deals';

  const { data: entity, error: fetchErr } = await serviceDb()
    .from(table)
    .select('tags')
    .eq('id', ctx.entityId)
    .single();

  if (fetchErr) return { success: false, actionType: 'add_tag', error: fetchErr.message };

  const currentTags: string[] = (entity?.tags as string[]) ?? [];
  if (currentTags.includes(tag)) {
    return { success: true, actionType: 'add_tag', details: { alreadyExists: true } };
  }

  const { error } = await serviceDb()
    .from(table)
    .update({ tags: [...currentTags, tag] })
    .eq('id', ctx.entityId);

  if (error) return { success: false, actionType: 'add_tag', error: error.message };
  return { success: true, actionType: 'add_tag', details: { tag } };
}

async function removeTag(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const tag = config.tag as string;
  const table = ctx.entityType === 'contact' ? 'crm_contacts' : 'crm_deals';

  const { data: entity, error: fetchErr } = await serviceDb()
    .from(table)
    .select('tags')
    .eq('id', ctx.entityId)
    .single();

  if (fetchErr) return { success: false, actionType: 'remove_tag', error: fetchErr.message };

  const currentTags: string[] = (entity?.tags as string[]) ?? [];
  const { error } = await serviceDb()
    .from(table)
    .update({ tags: currentTags.filter(t => t !== tag) })
    .eq('id', ctx.entityId);

  if (error) return { success: false, actionType: 'remove_tag', error: error.message };
  return { success: true, actionType: 'remove_tag', details: { tag } };
}

// Allowlisted fields per entity to prevent arbitrary column writes
const WRITABLE_FIELDS: Record<string, Set<string>> = {
  deal: new Set(['title', 'title_ar', 'value', 'currency', 'probability', 'expected_close', 'source', 'notes', 'custom_fields']),
  contact: new Set(['name', 'name_ar', 'email', 'phone', 'company', 'title', 'source', 'notes', 'custom_fields']),
  task: new Set(['title', 'title_ar', 'description', 'status', 'priority', 'due_date']),
};

async function updateField(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const field = config.field as string;
  const value = config.value;

  const tableMap: Record<string, string> = {
    deal: 'crm_deals',
    contact: 'crm_contacts',
    task: 'crm_tasks',
  };
  const table = tableMap[ctx.entityType];
  if (!table) return { success: false, actionType: 'update_field', error: `No table for ${ctx.entityType}` };

  // Validate field against allowlist to prevent arbitrary column writes
  const allowed = WRITABLE_FIELDS[ctx.entityType];
  if (!allowed || !allowed.has(field)) {
    return { success: false, actionType: 'update_field', error: `Field '${field}' is not writable via automation` };
  }

  const { error } = await serviceDb()
    .from(table)
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq('id', ctx.entityId);

  if (error) return { success: false, actionType: 'update_field', error: error.message };
  return { success: true, actionType: 'update_field', details: { field, value } };
}

async function createOutboundDraft(
  ctx: ActionContext,
  actionType: ActionType,
  channel: 'email' | 'whatsapp' | 'slack' | 'webhook',
  recipient: string,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  const { data, error } = await serviceDb()
    .from('crm_outbound_drafts')
    .insert({
      org_id: ctx.orgId,
      workflow_id: ctx.workflowId,
      channel,
      recipient,
      payload,
      entity_type: ctx.entityType,
      entity_id: ctx.entityId,
    })
    .select('id')
    .single();
  if (error || !data) return { success: false, actionType, error: error?.message ?? 'Could not create draft' };
  return { success: true, actionType, details: { draftId: data.id, status: 'draft' } };
}

function contactIdFor(ctx: ActionContext): string | null {
  if (ctx.entityType === 'contact') return ctx.entityId;
  const fromData = ctx.entityData.contactId ?? ctx.entityData.contact_id;
  return typeof fromData === 'string' ? fromData : null;
}

// There is no automatic email or WhatsApp sender, so these always wait for a person.
async function sendEmail(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const contactId = contactIdFor(ctx);
  if (!contactId) return { success: false, actionType: 'send_email', error: 'No contact to email' };
  return createOutboundDraft(ctx, 'send_email', 'email', contactId, {
    subject: resolveTemplate(config.subject as string, ctx.entityData),
    body: resolveTemplate(config.body as string, ctx.entityData),
    templateId: config.templateId ?? null,
  });
}

async function sendWhatsApp(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const contactId = contactIdFor(ctx);
  if (!contactId) return { success: false, actionType: 'send_whatsapp', error: 'No contact to message' };
  const params = Array.isArray(config.templateParams)
    ? (config.templateParams as unknown[]).map(p => resolveTemplate(String(p), ctx.entityData))
    : [];
  return createOutboundDraft(ctx, 'send_whatsapp', 'whatsapp', contactId, {
    templateName: config.templateName ?? '',
    language: config.language ?? 'ar',
    params,
  });
}

async function sendSlack(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const message = resolveTemplate(config.message as string, ctx.entityData);
  const channelId = config.channelId as string;
  if (!channelId) {
    return { success: false, actionType: 'send_slack', error: 'No channelId configured' };
  }
  if (ctx.requiresConfirmation) {
    return createOutboundDraft(ctx, 'send_slack', 'slack', channelId, { message });
  }
  const sent = await postSlackMessage(ctx.orgId, channelId, message);
  return sent.ok
    ? { success: true, actionType: 'send_slack', details: sent.details }
    : { success: false, actionType: 'send_slack', error: sent.error };
}

async function assignTo(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const userId = config.userId as string | undefined;
  const method = config.method as string | undefined;

  let assigneeId = userId;

  if (method === 'round_robin') {
    // Fetch org members and pick next in rotation
    const { data: members } = await serviceDb()
      .from('org_members')
      .select('user_id')
      .eq('org_id', ctx.orgId)
      .eq('is_active', true)
      .order('joined_at', { ascending: true });

    if (members && members.length > 0) {
      // Round-robin via hash — apply abs BEFORE modulo to avoid negative index
      const index = Math.abs(hashCode(ctx.entityId)) % members.length;
      assigneeId = members[index].user_id;
    }
  }

  if (!assigneeId) {
    return { success: false, actionType: 'assign_to', error: 'No assignee resolved' };
  }

  const tableMap: Record<string, string> = {
    deal: 'crm_deals',
    contact: 'crm_contacts',
    task: 'crm_tasks',
  };
  const table = tableMap[ctx.entityType];
  if (!table) return { success: false, actionType: 'assign_to', error: `No table for ${ctx.entityType}` };

  const { error } = await serviceDb()
    .from(table)
    .update({ assigned_to: assigneeId, updated_at: new Date().toISOString() })
    .eq('id', ctx.entityId);

  if (error) return { success: false, actionType: 'assign_to', error: error.message };
  return { success: true, actionType: 'assign_to', details: { assigneeId } };
}

async function handleWait(config: Record<string, unknown>): Promise<ActionResult> {
  // Wait actions are non-blocking — they record a resume timestamp.
  // The scheduler picks up workflows with pending wait actions.
  const minutes = Number(config.minutes ?? 0);
  const hours = Number(config.hours ?? 0);
  const days = Number(config.days ?? 0);
  const totalMs = (minutes * 60 + hours * 3600 + days * 86400) * 1000;

  return {
    success: true,
    actionType: 'wait',
    details: {
      resumeAt: new Date(Date.now() + totalMs).toISOString(),
      durationMs: totalMs,
    },
  };
}

/** Fields safe to include in outbound webhook payloads */
const WEBHOOK_SAFE_FIELDS = new Set([
  'id', 'title', 'title_ar', 'name', 'name_ar', 'value', 'currency',
  'status', 'stage_id', 'pipeline_id', 'probability', 'source', 'tags',
  'type', 'priority', 'due_date', 'created_at', 'updated_at',
]);

async function callWebhook(
  config: Record<string, unknown>,
  ctx: ActionContext
): Promise<ActionResult> {
  const url = config.url as string;
  if (!url) return { success: false, actionType: 'webhook', error: 'No URL configured' };
  const blocked = webhookTargetError(url);
  if (blocked) return { success: false, actionType: 'webhook', error: blocked };

  // Strip sensitive fields from outbound payload
  const safeData: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(ctx.entityData)) {
    if (WEBHOOK_SAFE_FIELDS.has(key)) safeData[key] = val;
  }
  const body = { event: ctx.entityType, entityId: ctx.entityId, data: safeData, timestamp: new Date().toISOString() };
  const headers = (config.headers as Record<string, string>) ?? {};

  if (ctx.requiresConfirmation) {
    return createOutboundDraft(ctx, 'webhook', 'webhook', url, { headers, body });
  }
  const sent = await postWebhook(url, headers, body);
  return sent.ok
    ? { success: true, actionType: 'webhook', details: sent.details }
    : { success: false, actionType: 'webhook', error: sent.error };
}

// ── Helpers ──────────────────────────────────────────────────

/** Replace {{field}} placeholders with entity data values */
function resolveTemplate(
  template: string | undefined | null,
  data: Record<string, unknown>
): string {
  if (!template) return '';
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((obj, key) => {
      if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
      return undefined;
    }, data);
    return value != null ? String(value) : '';
  });
}

/** Determine notification recipients from config */
function resolveRecipients(
  config: Record<string, unknown>,
  ctx: ActionContext
): string[] {
  const recipients: string[] = [];

  if (config.userId) recipients.push(config.userId as string);
  if (config.assignee && ctx.entityData.assignedTo) {
    recipients.push(ctx.entityData.assignedTo as string);
  }
  if (config.creator && ctx.entityData.createdBy) {
    recipients.push(ctx.entityData.createdBy as string);
  }
  if (config.userIds && Array.isArray(config.userIds)) {
    recipients.push(...(config.userIds as string[]));
  }

  // Deduplicate
  return [...new Set(recipients.filter(Boolean))];
}

/** Simple hash for round-robin distribution */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}
