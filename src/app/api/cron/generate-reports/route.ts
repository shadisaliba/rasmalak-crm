/**
 * Cron: Generate Reports
 * ======================
 * Runs daily at 4AM.
 * - Sunday: weekly manager pipeline report
 * - Every day: daily rep brief
 * Creates notifications with report text.
 */

import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/serverAuth';
import { serviceDb } from '@/lib/supabaseServer';
import { orchestrator } from '@/ai/orchestrator';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized.error;

  const now = new Date();
  const isSunday = now.getDay() === 0;
  let managerReports = 0;
  let repBriefs = 0;
  let errors = 0;

  try {
    // Get all orgs with active subscriptions
    const { data: orgs } = await serviceDb()
      .from('subscriptions')
      .select('org_id, plan')
      .in('status', ['active', 'trialing']);

    if (!orgs) return NextResponse.json({ ok: true, managerReports: 0, repBriefs: 0 });

    for (const org of orgs) {
      // Determine org language from settings
      const { data: orgData } = await serviceDb()
        .from('organizations')
        .select('settings, name, currency')
        .eq('id', org.org_id)
        .single();

      const language = ((orgData?.settings as Record<string, unknown>)?.language as 'ar' | 'en') ?? 'ar';
      const currency = orgData?.currency ?? 'USD';


      // Weekly manager report (Sundays only, Enterprise plans)
      if (isSunday && (org.plan === 'enterprise' || org.plan === 'organization')) {
        try {
          // Gather pipeline data
          const { data: openDeals } = await serviceDb()
            .from('crm_deals')
            .select('title, value, ai_score, probability, stage_id')
            .eq('org_id', org.org_id)
            .is('closed_at', null)
            .limit(50);

          const { data: closedWon } = await serviceDb()
            .from('crm_deals')
            .select('value, crm_deal_stages!inner(is_won)')
            .eq('org_id', org.org_id)
            .eq('crm_deal_stages.is_won', true)
            .gte('closed_at', new Date(Date.now() - 7 * 86400000).toISOString());

          const { data: closedLost } = await serviceDb()
            .from('crm_deals')
            .select('value, crm_deal_stages!inner(is_lost)')
            .eq('org_id', org.org_id)
            .eq('crm_deal_stages.is_lost', true)
            .gte('closed_at', new Date(Date.now() - 7 * 86400000).toISOString());

          const totalValue = (openDeals ?? []).reduce((sum, d) => sum + (d.value ?? 0), 0);
          const atRisk = (openDeals ?? []).filter(d => (d.ai_score ?? 50) < 40);
          const topDeals = (openDeals ?? [])
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
            .slice(0, 5);

          const generated = await orchestrator.completeForServerTask({
            task: 'report_generation',
            orgId: org.org_id,
            payload: { language, report: { kind: 'manager', data: {
            orgName: orgData?.name ?? 'Organization',
            totalOpenDeals: openDeals?.length ?? 0,
            totalPipelineValue: totalValue,
            currency,
            dealsByStage: [],
            closedThisWeek: {
              won: closedWon?.length ?? 0,
              wonValue: (closedWon ?? []).reduce((s, d) => s + (d.value ?? 0), 0),
              lost: closedLost?.length ?? 0,
              lostValue: (closedLost ?? []).reduce((s, d) => s + (d.value ?? 0), 0),
            },
            teamActivity: { totalComms: 0, totalTasks: 0, overdueCount: 0 },
            atRiskDeals: atRisk.map(d => ({
              title: d.title, value: d.value ?? 0,
              score: d.ai_score ?? 0, reason: 'Low AI score',
            })),
            topDeals: topDeals.map(d => ({
              title: d.title, value: d.value ?? 0,
              score: d.ai_score ?? 50, probability: d.probability ?? 50,
            })),
            language,
            } } },
          });
          // A failed run leaves no notification rather than an error message posing as a report.
          if (!generated.ok) throw new Error(generated.reason);
          const report = generated.output.text;

          // Send to org admins/owners
          const { data: admins } = await serviceDb()
            .from('org_members')
            .select('user_id')
            .eq('org_id', org.org_id)
            .in('role', ['owner', 'admin', 'manager']);

          for (const admin of admins ?? []) {
            await serviceDb().from('crm_notifications').insert({
              org_id: org.org_id,
              user_id: admin.user_id,
              title: language === 'ar' ? 'تقرير خط المبيعات الأسبوعي' : 'Weekly Pipeline Report',
              body: report,
              type: 'report',
            });
          }
          managerReports++;
        } catch {
          errors++;
        }
      }

      // Daily rep briefs
      try {
        const { data: reps } = await serviceDb()
          .from('org_members')
          .select('user_id, display_name')
          .eq('org_id', org.org_id)
          .eq('is_active', true)
          .in('role', ['owner', 'admin', 'manager', 'sales_rep']);

        for (const rep of reps ?? []) {
          const { data: repDeals } = await serviceDb()
            .from('crm_deals')
            .select('title, value, ai_score')
            .eq('org_id', org.org_id)
            .eq('assigned_to', rep.user_id)
            .is('closed_at', null)
            .limit(10);

          const { data: todayTasks } = await serviceDb()
            .from('crm_tasks')
            .select('title, priority')
            .eq('org_id', org.org_id)
            .eq('assigned_to', rep.user_id)
            .eq('status', 'pending')
            .lte('due_date', new Date(Date.now() + 86400000).toISOString())
            .limit(10);

          const { data: overdueItems } = await serviceDb()
            .from('crm_tasks')
            .select('title, due_date')
            .eq('org_id', org.org_id)
            .eq('assigned_to', rep.user_id)
            .eq('status', 'pending')
            .lt('due_date', new Date().toISOString())
            .limit(5);

          // Skip if rep has no deals or tasks
          if ((!repDeals || repDeals.length === 0) && (!todayTasks || todayTasks.length === 0)) continue;

          const generated = await orchestrator.completeForServerTask({
            task: 'report_generation',
            orgId: org.org_id,
            payload: { language, report: { kind: 'rep_brief', data: {
            repName: rep.display_name ?? 'Team Member',
            openDeals: (repDeals ?? []).map(d => ({
              title: d.title, value: d.value ?? 0,
              score: d.ai_score ?? 50, nextAction: 'Follow up',
            })),
            todayTasks: (todayTasks ?? []).map(t => ({
              title: t.title, priority: t.priority ?? 'medium', relatedDeal: null,
            })),
            overdueItems: (overdueItems ?? []).map(o => ({
              title: o.title, dueDate: o.due_date ?? '',
            })),
            language,
            } } },
          });
          if (!generated.ok) {
            errors++;
            continue;
          }
          const brief = generated.output.text;

          await serviceDb().from('crm_notifications').insert({
            org_id: org.org_id,
            user_id: rep.user_id,
            title: language === 'ar' ? 'ملخصك اليومي' : 'Your Daily Brief',
            body: brief,
            type: 'report',
          });
          repBriefs++;
        }
      } catch {
        errors++;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation error';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true, managerReports, repBriefs, errors,
    timestamp: new Date().toISOString(),
  });
}
