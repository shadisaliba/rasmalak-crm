/**
 * Cron: Scheduled Automation
 * ==========================
 * Runs every 5 minutes. Checks overdue tasks, inactive deals,
 * and scheduled workflow triggers.
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { runScheduledAutomation } from '@/automation/scheduler';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;

  try {
    const result = await runScheduledAutomation();

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scheduler error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
