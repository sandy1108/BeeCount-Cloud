import { isFutureBucket } from '../../lib/skiSeason'
import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, useLocale, useT } from '@beecount/ui'

import { formatCompactTick } from '../../i18n/format'
import { MonthDrilldownLinks } from './MonthDrilldownLinks'
import { DEFAULT_TREND_VISIBILITY, toggleTrendSeries, type TrendSeries, type TrendSeriesVisibility } from '../../lib/trendSeriesVisibility'

interface SeriesItem {
  bucket: string
  expense: number
  income: number
  balance: number
  count?: number
}

interface Props {
  data: SeriesItem[]
  title?: string
  showAll?: boolean
  statisticsFocus?: 'balance' | 'expense'
  onMonthClick?: (month: string) => void
}

// 固定取最近 N 个月。原来有 6 / 12 / 24 期切换,但 server.series 通常只
// 返当年数据,切到 24 期没新内容,反而让用户疑惑"按钮没用",直接拿掉。
// 12 是"完整年度"的天然窗口,看得到季节性又不拥挤。
const TREND_WINDOW = 12

/** 保留普通年度窗口；自定义周期必须完整展示，尤其本月可能有31个日桶。 */
export function prepareTrendSeries(data: SeriesItem[], showAll = false) {
  const selected = showAll ? data : data.slice(-TREND_WINDOW)
  return selected.map((d) => ({
    ...d,
    balance: Number.isFinite(d.balance) ? d.balance : (d.income ?? 0) - (d.expense ?? 0),
  }))
}

/**
 * 收支柱保留原始流水口径；折线随统计视角展示支出或净额。
 *
 * 复用服务端聚合的月/日桶；净额缺失时才用收入减支出兜底，不改原始收支。
 */
export function MonthlyTrendBars({ data, title, showAll = false, statisticsFocus = 'balance', onMonthClick }: Props) {
  const t = useT()
  const { locale } = useLocale()
  const chinese = locale.startsWith('zh')
  // 支出视角使用正的支出金额，不能简单反转净额，否则收入也会被反向混入。
  const lineMetric = statisticsFocus === 'expense' ? 'expense' : 'balance'
  // 每张图独立、每次新打开默认只看趋势；不写账号或浏览器持久配置。
  const [visibility, setVisibility] = useState<TrendSeriesVisibility>(() => ({ ...DEFAULT_TREND_VISIBILITY }))
  const trendLabel = t(statisticsFocus === 'expense' ? 'home.trendBars.expenseLine' : 'home.trendBars.balanceLine')

  const slice = useMemo(() => prepareTrendSeries(data, showAll), [data, showAll])

  const fmt = (v: number) =>
    v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  // 12 期 x 轴 label 直接用月份末位(MM),完整 bucket 由 tooltip 提供
  const xTickFormatter = (bucket: string): string => {
    if (showAll) return isFutureBucket(bucket) ? `${bucket}*` : bucket
    const parts = bucket.split('-')
    if (parts.length >= 2) return parts.slice(1).join('-')
    return bucket
  }

  return (
    <Card className="bc-panel overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">{title || t('home.trendBars.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <TrendSeriesControls visibility={visibility} onToggle={series => setVisibility(current => toggleTrendSeries(current, series))} trendLabel={trendLabel} />
        {slice.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            {t('home.trendBars.empty')}
          </div>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={slice} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                onClick={state => { if (typeof state.activeLabel === 'string' && /^\d{4}-\d{2}$/.test(state.activeLabel)) onMonthClick?.(state.activeLabel) }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  stroke="hsl(var(--border))"
                  tickFormatter={xTickFormatter}
                  interval={showAll ? 'preserveStartEnd' : 0}
                />
                <YAxis
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                  stroke="hsl(var(--border))"
                  tickFormatter={(v) =>
                    formatCompactTick(v, { chinese, wanUnit: t('common.unit.10k') })
                  }
                />
                <Tooltip
                  labelFormatter={value => {
                    const row = slice.find(item => item.bucket === String(value))
                    const recorded = Boolean(row?.income || row?.expense || row?.count)
                    return `${value}${showAll && isFutureBucket(String(value)) ? ` · ${t(recorded ? 'statistics.futureRecorded' : 'statistics.future')}` : ''}`
                  }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    fontSize: 12
                  }}
                  cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                  formatter={((v: number, name: string) => {
                    const label =
                      name === 'income'
                        ? t('home.trendBars.income')
                        : name === 'expense'
                          ? t('home.trendBars.expense')
                          : name === 'balance'
                            ? t('home.trendBars.balance')
                            : name
                    return [fmt(v), label]
                  }) as unknown as never}
                />
                {/* income / expense 柱子用 token 跟随用户配色偏好。趋势折线
                    用 primary 色 — 跟主题色绑定,亮暗模式都看得清。 */}
                {visibility.income && <Bar
                  dataKey="income"
                  fill="rgb(var(--income-rgb))"
                  radius={[4, 4, 0, 0]}
                />}
                {visibility.expense && <Bar
                  dataKey="expense"
                  fill="rgb(var(--expense-rgb))"
                  radius={[4, 4, 0, 0]}
                />}
                {visibility.trend && <Line
                  type="monotone"
                  dataKey={lineMetric}
                  name={trendLabel}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                  activeDot={{ r: 5 }}
                />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('home.trendBars.visibilityHint')}</p>
        {visibility.trend && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(statisticsFocus === 'expense' ? 'home.trendBars.expenseHint' : 'home.trendBars.balanceHint')}</p>}
        {showAll && slice.some(row => isFutureBucket(row.bucket)) && <p className="mt-2 text-[11px] text-muted-foreground">* {t('statistics.futureHint')}</p>}
        {onMonthClick && <MonthDrilldownLinks buckets={slice.map(row => row.bucket)} onSelect={onMonthClick} />}
      </CardContent>
    </Card>
  )
}

/** 多选按钮兼作图例，颜色和图层一致；禁用最后一个选中项，始终保留可读图表。 */
export function TrendSeriesControls({ visibility, onToggle, trendLabel }: {
  visibility: TrendSeriesVisibility; onToggle: (series: TrendSeries) => void; trendLabel: string
}) {
  const t = useT()
  const count = Object.values(visibility).filter(Boolean).length
  const options: Array<{ key: TrendSeries; label: string; color: string }> = [
    { key: 'expense', label: t('home.trendBars.expense'), color: 'rgb(var(--expense-rgb))' },
    { key: 'income', label: t('home.trendBars.income'), color: 'rgb(var(--income-rgb))' },
    { key: 'trend', label: trendLabel, color: 'hsl(var(--primary))' },
  ]
  return <div role="group" aria-label={t('home.trendBars.visibility')} className="mb-4 flex flex-wrap gap-2">
    {options.map(option => <button key={option.key} type="button" aria-pressed={visibility[option.key]}
      disabled={visibility[option.key] && count === 1} title={t('home.trendBars.visibilityHint')}
      onClick={() => onToggle(option.key)}
      className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed ${visibility[option.key] ? 'border-primary/40 bg-primary/10 font-semibold text-foreground' : 'border-border/70 bg-background text-muted-foreground hover:bg-muted/60'}`}>
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: option.color }} />
      {option.label}<span aria-hidden="true" className="inline-block w-3 text-center">{visibility[option.key] ? '✓' : ''}</span>
    </button>)}
  </div>
}
