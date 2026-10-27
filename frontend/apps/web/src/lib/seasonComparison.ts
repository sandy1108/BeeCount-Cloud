import type { SeasonComparisonSide, WorkspaceAnalyticsCategoryRank } from '@beecount/api-client'
import { seasonLabel, seasonMonths } from './skiSeason'
import type { StatisticsContext } from './statisticsContext'

export type ComparisonMetric = 'expense' | 'income' | 'balance'
export function localDateAtOffset(now: Date, offset: number) {
  return new Date(now.getTime() + offset * 60000).toISOString().slice(0, 10)
}
export function defaultComparisonMode(year: number, today: string): 'same' | 'full' {
  return today >= `${year + 1}-05-01` ? 'full' : 'same'
}
export function defaultComparisonCutoff(year: number, today: string): string {
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0,10)
  if (yesterday < `${year}-05-01`) return ''
  return yesterday > `${year + 1}-04-30` ? `${year + 1}-04-30` : yesterday
}
/** 结余无正基数时只报金额差；零分母不显示Infinity或误导的100%。 */
export function comparisonDelta(selected: number, comparison: number, metric: ComparisonMetric) {
  return { amount: selected - comparison, rate: comparison > 0 ? (selected - comparison) / comparison : null,
    bothZero: selected === 0 && comparison === 0, nonPositiveBalance: metric === 'balance' && comparison <= 0 }
}
export function comparisonCategories(a: WorkspaceAnalyticsCategoryRank[], b: WorkspaceAnalyticsCategoryRank[]) {
  const left = new Map(a.map(row => [row.category_name, row]))
  const right = new Map(b.map(row => [row.category_name, row]))
  return Array.from(new Set([...left.keys(),...right.keys()])).map(name => ({ name,
    selected: left.get(name), comparison: right.get(name) })).sort((a,b) =>
      Math.abs((b.selected?.total ?? 0) - (b.comparison?.total ?? 0)) - Math.abs((a.selected?.total ?? 0) - (a.comparison?.total ?? 0)) || a.name.localeCompare(b.name))
}
/** 不在同期范围内的月份保留null，不能补成零消费；累计也不能延长到截止日之后。 */
export function comparisonMonths(a: SeasonComparisonSide, b: SeasonComparisonSide, metric: ComparisonMetric, cumulative: boolean) {
  let left = 0, right = 0
  return seasonMonths(a.range.year).map((bucket,index) => {
    const l = a.monthly.find(row => row.bucket === bucket)
    const other = seasonMonths(b.range.year)[index]
    const r = b.monthly.find(row => row.bucket === other)
    if (l) left += l[metric]
    if (r) right += r[metric]
    return { bucket, other, month: bucket.slice(-2), selected: l ? cumulative ? left : l[metric] : null,
      comparison: r ? cumulative ? right : r[metric] : null, partial: Boolean(l?.partial || r?.partial) }
  })
}
export function comparisonContext(side: SeasonComparisonSide, ledger: { ledgerId: string; ledgerName: string; currency: string }, offset: number, category?: { name: string; kind: 'income'|'expense' }): StatisticsContext {
  return { ...ledger, dateFrom: side.range.start_at, dateTo: side.range.end_at_exclusive,
    tzOffsetMinutes: offset, naturalMonth: true, periodLabel: seasonLabel(side.range.year),
    txType: category?.kind ?? 'cashflow', categoryGroup: category?.name }
}

/** 基于地址栏最新值合并设置，避免连续切控件时用旧React快照覆盖上一操作。 */
export function patchComparisonSettings(search: URLSearchParams, scopeKey: string, defaults: Record<string,string>, values: Record<string,string>) {
  const next = new URLSearchParams(search)
  if (next.get('compareFor') !== scopeKey) {
    for (const key of [...next.keys()]) if (key.startsWith('compare') && key !== 'compare') next.delete(key)
  }
  for (const [key,value] of Object.entries(defaults)) if (!next.has(key)) next.set(key,value)
  next.set('compareFor',scopeKey)
  Object.entries(values).forEach(([key,value])=>next.set(key,value))
  return next
}

/** Recharts会过滤零高度柱，回调index不是月份序号；必须读取被点击柱的原始数据。 */
export function comparisonBarMonth(entry: { payload?: unknown }, side: 'selected'|'comparison'): string | null {
  if (!entry.payload || typeof entry.payload !== 'object') return null
  const row = entry.payload as Record<string,unknown>
  const bucket = row[side === 'selected' ? 'bucket' : 'other']
  return typeof row[side] === 'number' && typeof bucket === 'string' && /^\d{4}-\d{2}$/.test(bucket) ? bucket : null
}
