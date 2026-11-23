import { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { Card, SectionHead } from '../components/ui';

// Room around the plot so the first/last X labels and the labels under the axis are not cut off by the SVG edge.
const MARGIN = { top: 8, right: 16, bottom: 4, left: 0 };

export function AdminChart({ title, subtitle, data, dataKey, bar = false, color = 'var(--color-brand)', axisFormat, valueFormat }: {
  title: string; subtitle?: string; data: Record<string, string | number>[]; dataKey: string; bar?: boolean; color?: string;
  /** Formats Y-axis ticks (e.g. compact money); `valueFormat` formats the tooltip value. Plain numbers by default. */
  axisFormat?: (value: number) => string; valueFormat?: (value: number) => string;
}) {
  const gradient = `admin-fill-${useId().replace(/:/g, '')}`;
  const axes = <>
    <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="3 4" />
    <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickLine={false} axisLine={false} tickMargin={8} height={28}
      interval="preserveStartEnd" padding={bar ? undefined : { left: 12, right: 12 }} />
    <YAxis allowDecimals={false} tickFormatter={axisFormat} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={axisFormat ? 56 : 40} />
    <Tooltip contentStyle={{ background: 'var(--color-popover)', color: 'var(--color-ink)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 }}
      itemStyle={{ color: 'var(--color-ink)' }} formatter={valueFormat ? (value: number) => valueFormat(Number(value)) : undefined} cursor={bar ? { fill: 'var(--color-line)', opacity: 0.4 } : { stroke: 'var(--color-line)' }} />
  </>;
  return <Card className="p-5"><SectionHead title={title} subtitle={subtitle} />
    <div role="img" aria-label={`${title}: ${data.map(d => `${d.name} ${valueFormat ? valueFormat(Number(d[dataKey])) : d[dataKey]}`).join(', ')}`} className="h-[220px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">{bar
        ? <BarChart data={data} margin={MARGIN}>{axes}<Bar dataKey={dataKey} name={title} fill={color} radius={[4, 4, 0, 0]} maxBarSize={26} /></BarChart>
        : <AreaChart data={data} margin={MARGIN}>
          {/* soft fade under the line instead of a flat grey band */}
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient></defs>
          {axes}
          <Area dataKey={dataKey} name={title} type="monotone" stroke={color} strokeWidth={2} fill={`url(#${gradient})`} />
        </AreaChart>}</ResponsiveContainer>
    </div></Card>;
}
