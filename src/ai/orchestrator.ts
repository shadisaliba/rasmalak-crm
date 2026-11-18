/**
 * The single entry point for LLM calls (CLAUDE.md rule 3, playbook R14).
 *
 * Nothing outside src/ai/ imports a provider; ESLint enforces it. This module currently serves
 * server tasks (cron jobs). The conversational assistant is rebuilt on top of it in W3b-07.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AI_CONFIG } from './config';
import { dealScoringAgent, buildDealScoringContext } from './agents/dealScoringAgent';
import { reportGeneratorAgent, buildManagerReportContext, buildRepBriefContext } from './agents/reportGeneratorAgent';
import type { AgentDefinition } from './agents/types';
import { serviceDb } from '@/lib/supabaseServer';

export type ServerTask = 'deal_scoring' | 'report_generation';

type ReportRequest =
  | { kind: 'manager'; data: Parameters<typeof buildManagerReportContext>[0] }
  | { kind: 'rep_brief'; data: Parameters<typeof buildRepBriefContext>[0] };

export interface ServerTaskPayloads {
  deal_scoring: { deal: Parameters<typeof buildDealScoringContext>[0] };
  report_generation: { language: 'ar' | 'en'; report: ReportRequest };
}

const DealScoreSchema = z.object({
  score: z.number().min(0).max(100),
  trend: z.enum(['improving', 'stable', 'declining']),
  reasoning: z.string().min(1).max(2000),
  riskFactors: z.array(z.string()).optional(),
  suggestedActions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const ReportSchema = z.object({ text: z.string().trim().min(1).max(8000) });

export interface ServerTaskOutputs {
  deal_scoring: z.infer<typeof DealScoreSchema>;
  report_generation: z.infer<typeof ReportSchema>;
}

export type ServerTaskFailure = 'not_configured' | 'provider_error' | 'timeout' | 'invalid_output';

export type ServerTaskResult<T extends ServerTask> =
  | { ok: true; output: ServerTaskOutputs[T] }
  | { ok: false; reason: ServerTaskFailure };

export interface ServerTaskRequest<T extends ServerTask> {
  task: T;
  orgId: string;
  payload: ServerTaskPayloads[T];
}

// Longer than the provider's own 30 s request timeout, so a hung stream is still cut off.
const SERVER_TASK_TIMEOUT_MS = 45_000;

const MAX_TOKENS: Record<ServerTask, number> = { deal_scoring: 500, report_generation: 1000 };

function promptParams(language: 'ar' | 'en'): Parameters<AgentDefinition['systemPromptBuilder']>[0] {
  return { language, contextSlices: [], memoryFields: {}, deterministic: null, userMessage: '', conversationHistory: [] };
}

function buildPrompt<T extends ServerTask>(req: ServerTaskRequest<T>): { system: string; user: string } {
  if (req.task === 'deal_scoring') {
    const { deal } = req.payload as ServerTaskPayloads['deal_scoring'];
    return { system: dealScoringAgent.systemPromptBuilder(promptParams('en')), user: buildDealScoringContext(deal) };
  }
  const { language, report } = req.payload as ServerTaskPayloads['report_generation'];
  const user = report.kind === 'manager' ? buildManagerReportContext(report.data) : buildRepBriefContext(report.data);
  return { system: reportGeneratorAgent.systemPromptBuilder(promptParams(language)), user };
}

function parseOutput<T extends ServerTask>(task: T, text: string): ServerTaskOutputs[T] | null {
  if (task === 'deal_scoring') {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    try {
      const parsed = DealScoreSchema.safeParse(JSON.parse(json));
      return parsed.success ? (parsed.data as ServerTaskOutputs[T]) : null;
    } catch {
      return null;
    }
  }
  const parsed = ReportSchema.safeParse({ text });
  return parsed.success ? (parsed.data as ServerTaskOutputs[T]) : null;
}

async function callProvider(system: string, user: string, maxTokens: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  const options = { max_tokens: maxTokens };
  const result = AI_CONFIG.provider === 'gemini'
    ? await (await import('./providers/gemini')).sendChatCompletion(messages, options)
    : await (await import('./providers/openai')).sendChatCompletion(messages, options);
  return result.success ? { ok: true, text: result.content } : { ok: false };
}

function hasProviderKey(): boolean {
  if (AI_CONFIG.provider === 'gemini') return Boolean(process.env.GOOGLE_AI_API_KEY);
  if (AI_CONFIG.provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

// Records that a call happened and how it went. Prompt and output text are not stored: they
// contain customer data, and these runs have no user who could consent to retention.
async function audit(orgId: string, task: ServerTask, status: 'ok' | ServerTaskFailure, latencyMs: number, inputDigest: string) {
  const { error } = await serviceDb().from('ai_task_runs').insert({
    org_id: orgId,
    task,
    provider: AI_CONFIG.provider,
    model: AI_CONFIG.model,
    status,
    latency_ms: Math.round(latencyMs),
    input_digest: inputDigest,
  });
  if (error) console.warn('[orchestrator] audit write failed:', error.message);
}

export async function completeForServerTask<T extends ServerTask>(req: ServerTaskRequest<T>): Promise<ServerTaskResult<T>> {
  const started = performance.now();
  const { system, user } = buildPrompt(req);
  const inputDigest = createHash('sha256').update(system).update('\u0000').update(user).digest('hex');

  const finish = async (result: ServerTaskResult<T>): Promise<ServerTaskResult<T>> => {
    await audit(req.orgId, req.task, result.ok ? 'ok' : result.reason, performance.now() - started, inputDigest);
    return result;
  };

  if (!hasProviderKey()) return finish({ ok: false, reason: 'not_configured' });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), SERVER_TASK_TIMEOUT_MS); });
  try {
    const response = await Promise.race([callProvider(system, user, MAX_TOKENS[req.task]), timeout]);
    if (response === 'timeout') return finish({ ok: false, reason: 'timeout' });
    if (!response.ok) return finish({ ok: false, reason: 'provider_error' });
    const output = parseOutput(req.task, response.text);
    return finish(output ? { ok: true, output } : { ok: false, reason: 'invalid_output' });
  } catch {
    return finish({ ok: false, reason: 'provider_error' });
  } finally {
    clearTimeout(timer);
  }
}

export const orchestrator = { completeForServerTask };
