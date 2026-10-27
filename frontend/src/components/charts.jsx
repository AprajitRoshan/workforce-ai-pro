import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

export const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316']
export const RISK_COLORS = { LOW: '#10b981', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#9f1239' }

const tick = { fill: '#8a94a6', fontSize: 11 }
const grid = <CartesianGrid strokeDasharray="3 3" stroke="#8a94a633" vertical={false} />
const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12, color: 'var(--ink)' },
  labelStyle: { color: 'var(--muted)', fontWeight: 600 },
  cursor: { fill: '#8a94a614' },
}

export function ChartBox({ height = 260, children }) {
  return <div style={{ width: '100%', height }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
}

export function BarsChart({ data, x, bars, height, stacked, layout, formatter }) {
  const vertical = layout === 'vertical'
  return (
    <ChartBox height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: vertical ? 8 : -12, bottom: 0 }}>
        {grid}
        {vertical ? (
          <>
            <XAxis type="number" tick={tick} axisLine={false} tickLine={false} tickFormatter={formatter} />
            <YAxis type="category" dataKey={x} tick={tick} axisLine={false} tickLine={false} width={120} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={tick} axisLine={false} tickLine={false} />
            <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={formatter} />
          </>
        )}
        <Tooltip {...tooltipStyle} formatter={formatter ? (v) => formatter(v) : undefined} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.name || b.key} fill={b.color || PALETTE[i]} stackId={stacked ? 's' : undefined}
            radius={stacked ? 0 : vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={38}>
            {b.cellColors && data.map((d, j) => <Cell key={j} fill={b.cellColors(d)} />)}
          </Bar>
        ))}
      </BarChart>
    </ChartBox>
  )
}

export function LinesChart({ data, x, lines, height, area, formatter, extra }) {
  const Chart = area ? AreaChart : LineChart
  return (
    <ChartBox height={height}>
      <Chart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {lines.map((l, i) => (
            <linearGradient key={l.key} id={`g-${l.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={l.color || PALETTE[i]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={l.color || PALETTE[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}
        <XAxis dataKey={x} tick={tick} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={tick} axisLine={false} tickLine={false} tickFormatter={formatter} domain={['auto', 'auto']} />
        <Tooltip {...tooltipStyle} formatter={formatter ? (v) => formatter(v) : undefined} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
        {extra}
        {lines.map((l, i) => area ? (
          <Area key={l.key} type="monotone" dataKey={l.key} name={l.name || l.key} stroke={l.color || PALETTE[i]} strokeWidth={2}
            fill={l.noFill ? 'transparent' : `url(#g-${l.key})`} strokeDasharray={l.dashed ? '5 4' : undefined} dot={false} />
        ) : (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name || l.key} stroke={l.color || PALETTE[i]} strokeWidth={2}
            strokeDasharray={l.dashed ? '5 4' : undefined} dot={false} />
        ))}
      </Chart>
    </ChartBox>
  )
}

export function DonutChart({ data, nameKey = 'name', valueKey = 'value', colors, height = 220, center, centerLabel = 'total' }) {
  const total = data.reduce((a, d) => a + (d[valueKey] || 0), 0)
  return (
    <div className="relative">
      <ChartBox height={height}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="none">
            {data.map((d, i) => <Cell key={i} fill={colors?.[d[nameKey]] || PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip {...tooltipStyle} />
        </PieChart>
      </ChartBox>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{center ?? total}</span>
        <span className="text-[11px] text-muted">{centerLabel}</span>
      </div>
    </div>
  )
}

export function Legendary({ items }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />{i.label} <b className="text-ink">{i.value}</b>
        </span>
      ))}
    </div>
  )
}
