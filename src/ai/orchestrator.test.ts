import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabaseServer', () => ({
  serviceDb: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; } }) }),
}));

const gemini = vi.fn();
vi.mock('./providers/gemini', () => ({ sendChatCompletion: (...args: unknown[]) => gemini(...args) }));
vi.mock('./providers/openai', () => ({ sendChatCompletion: vi.fn() }));

const { completeForServerTask } = await import('./orchestrator');

const deal = {
  title: 'Shop fit-out', value: 1234.567, currency: 'JOD', stageName: 'Qualified', daysInStage: 3, avgDaysForStage: 14,
  commsLast30Days: 2, orgAvgComms: 3, daysSinceLastContact: 3, openTasks: 1, overdueTasks: 0,
  contactName: null, contactTitle: null, contactCompany: null, historicalWinRate: 35, probability: 50,
};
const ORG = '00000000-0000-4000-a000-00000000000a';

beforeEach(() => {
  inserts.length = 0;
  gemini.mockReset();
  vi.stubEnv('GOOGLE_AI_API_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());

describe('completeForServerTask', () => {
  it('validates deal-score JSON and audits the run without storing content', async () => {
    gemini.mockResolvedValue({ success: true, content: 'Here: {"score": 72, "trend": "stable", "reasoning": "Active buyer"}', usage: {} });
    const result = await completeForServerTask({ task: 'deal_scoring', orgId: ORG, payload: { deal } });
    expect(result).toEqual({ ok: true, output: { score: 72, trend: 'stable', reasoning: 'Active buyer' } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ org_id: ORG, task: 'deal_scoring', status: 'ok' });
    expect(inserts[0].input_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserts[0])).not.toContain('Shop fit-out');
  });

  it('rejects output outside the schema', async () => {
    gemini.mockResolvedValue({ success: true, content: '{"score": 150, "trend": "up", "reasoning": ""}', usage: {} });
    const result = await completeForServerTask({ task: 'deal_scoring', orgId: ORG, payload: { deal } });
    expect(result).toEqual({ ok: false, reason: 'invalid_output' });
    expect(inserts[0].status).toBe('invalid_output');
  });

  it('reports provider errors without passing their text on', async () => {
    gemini.mockResolvedValue({ success: false, error: 'quota exceeded for key AIza...' });
    const result = await completeForServerTask({ task: 'deal_scoring', orgId: ORG, payload: { deal } });
    expect(result).toEqual({ ok: false, reason: 'provider_error' });
  });

  it('does not call a provider that has no key', async () => {
    vi.stubEnv('GOOGLE_AI_API_KEY', '');
    const result = await completeForServerTask({ task: 'deal_scoring', orgId: ORG, payload: { deal } });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
    expect(gemini).not.toHaveBeenCalled();
    expect(inserts[0].status).toBe('not_configured');
  });

  it('returns report text', async () => {
    gemini.mockResolvedValue({ success: true, content: '  Pipeline steady this week.  ', usage: {} });
    const result = await completeForServerTask({
      task: 'report_generation', orgId: ORG,
      payload: { language: 'en', report: { kind: 'rep_brief', data: { repName: 'Lina', openDeals: [], todayTasks: [], overdueItems: [], language: 'en' } } },
    });
    expect(result).toEqual({ ok: true, output: { text: 'Pipeline steady this week.' } });
  });
});
