'use client';

import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ForecastResult, Wire } from '../domain/types';
import { useForecastText } from './text';

// JOD has three decimals. The chart only draws; every figure a reader can act on is in the table.
const major = (minor: string) => Number(minor) / 1000;

export function ForecastChart({ result }: { result: Wire<ForecastResult> }) {
  const F = useForecastText();
  const data = result.weeks.map(w => ({
    week: F.date(w.start),
    in: major(w.inMinor),
    out: -major(w.outMinor),
    closing: major(w.closingMinor),
    band: result.variableSpend ? [major(w.bandLowMinor), major(w.bandHighMinor)] : null,
  }));
  const label = (key: string) => F.t(`forecast.chart.${key}`);
  const fmt = (value: number) => F.jod(BigInt(Math.round(value * 1000)));

  return (
    <figure role="img" aria-label={F.t('forecast.chart.label')} style={{ margin: 0, width: '100%', height: 300 }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--ds-border)" />
          <XAxis dataKey="week" reversed={F.isAr} tick={{ fontSize: 11, fill: 'var(--ds-text-muted)' }} interval="preserveStartEnd" />
          <YAxis orientation={F.isAr ? 'right' : 'left'} width={72} tick={{ fontSize: 11, fill: 'var(--ds-text-muted)' }}
            tickFormatter={(v: number) => F.number(Math.round(v))} />
          <Tooltip formatter={(value, name) => [Array.isArray(value) ? value.map(v => fmt(Number(v))).join(' – ') : fmt(Number(value)), String(name)]}
            contentStyle={{ background: 'var(--ds-bg-card)', border: '1px solid var(--ds-border)', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="var(--ds-warning-text)" strokeDasharray="4 4" />
          {result.variableSpend && (
            <Area dataKey="band" name={label('band')} stroke="var(--ds-border-tinted)" fill="var(--ds-bg-tinted)" isAnimationActive={false} />
          )}
          <Bar dataKey="in" name={label('in')} fill="var(--ds-primary)" isAnimationActive={false} />
          <Bar dataKey="out" name={label('out')} fill="var(--ds-error)" isAnimationActive={false} />
          <Line dataKey="closing" name={label('closing')} stroke="var(--ds-text-heading)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}
