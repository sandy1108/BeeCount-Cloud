/** 首页统计下钻的不可变快照；URL保存精确半开时间范围，不从“今天”重新计算。 */
export type StatisticsContext = {
  ledgerId: string
  ledgerName: string
  currency: string
  categoryGroup: string
  txType: 'income' | 'expense'
  dateFrom?: string
  dateTo?: string
  periodLabel: string
  naturalMonth: boolean
  tzOffsetMinutes: number
}

export function statisticsQuery(context: StatisticsContext) {
  return {
    ledgerId: context.ledgerId, categoryGroup: context.categoryGroup, txType: context.txType,
    statisticsOnly: true, dateFrom: context.dateFrom, dateTo: context.dateTo,
  }
}

export function statisticsLink(context: StatisticsContext, path = '/app/transactions') {
  return `${path}?${new URLSearchParams({ ledger: context.ledgerId, stats: JSON.stringify(context) })}`
}

export function parseStatisticsContext(search: URLSearchParams): StatisticsContext | null {
  try {
    const value = JSON.parse(search.get('stats') || 'null') as StatisticsContext | null
    if (!value || typeof value.ledgerId !== 'string' || !value.ledgerId ||
      value.ledgerId !== search.get('ledger') || typeof value.categoryGroup !== 'string' ||
      !['expense', 'income'].includes(value.txType) || typeof value.ledgerName !== 'string' ||
      typeof value.currency !== 'string' || typeof value.periodLabel !== 'string' ||
      typeof value.naturalMonth !== 'boolean' || !Number.isInteger(value.tzOffsetMinutes) ||
      value.tzOffsetMinutes < -720 || value.tzOffsetMinutes > 840) return null
    for (const date of [value.dateFrom, value.dateTo]) {
      if (date !== undefined && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) return null
    }
    if (value.dateFrom && value.dateTo && Date.parse(value.dateFrom) >= Date.parse(value.dateTo)) return null
    return value
  } catch { return null }
}

export function statisticsMonths(context: StatisticsContext): string[] | undefined {
  if (!context.naturalMonth || !context.dateFrom || !context.dateTo) return undefined
  const offset = context.tzOffsetMinutes * 60000
  const start = new Date(Date.parse(context.dateFrom) + offset)
  const end = new Date(Date.parse(context.dateTo) + offset - 1)
  const buckets: string[] = []
  for (let year = start.getUTCFullYear(), month = start.getUTCMonth();
    year < end.getUTCFullYear() || (year === end.getUTCFullYear() && month <= end.getUTCMonth());) {
    buckets.push(`${year}-${String(month + 1).padStart(2, '0')}`)
    if (++month === 12) { month = 0; year++ }
  }
  return buckets
}

export function statisticsRangeLabel(context: StatisticsContext) {
  const offset = context.tzOffsetMinutes * 60000
  const from = context.dateFrom ? new Date(Date.parse(context.dateFrom) + offset).toISOString().slice(0, 10) : ''
  const to = context.dateTo ? new Date(Date.parse(context.dateTo) + offset - 1).toISOString().slice(0, 10) : ''
  return [context.ledgerName, context.periodLabel, from && to ? `${from} — ${to}` : '', context.currency].filter(Boolean).join(' · ')
}
