import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import { Card, SectionHead } from '../components/ui';

export function AdminChart({ title, subtitle, data, dataKey, bar = false, color = 'var(--color-brand)' }: {
  title: string; subtitle?: string; data: Record<string, string | number>[]; dataKey: string; bar?: boolean; color?: string;
}) {
  const axes = <>
    <CartesianGrid stroke="var(--color-line)" vertical={false} strokeDasharray="3 4" />
    <XAxis dataKey="name" tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickLine={false} axisLine={false} dy={6} />
    <YAxis allowDecimals={false} tick={{ fill: 'var(--color-muted)', fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
    <Tooltip contentStyle={{ background: 'var(--color-popover)', color: 'var(--color-ink)', border: '1px solid var(--color-line)', borderRadius: 8, fontSize: 12 }} itemStyle={{ color: 'var(--color-ink)' }} cursor={{ fill: 'var(--color-line)' }} />
  </>;
  return <Card className="p-5"><SectionHead title={title} subtitle={subtitle} /><div role="img" aria-label={`${title}: ${data.map(d => `${d.name} ${d[dataKey]}`).join(', ')}`} className="h-[210px] min-w-0"><ResponsiveContainer width="100%" height="100%">{bar ? <BarChart data={data}>{axes}<Bar dataKey={dataKey} name={title} fill={color} radius={[4, 4, 0, 0]} maxBarSize={26} /></BarChart> : <AreaChart data={data}>{axes}<Area dataKey={dataKey} name={title} type="monotone" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.08} /></AreaChart>}</ResponsiveContainer></div></Card>;
}
