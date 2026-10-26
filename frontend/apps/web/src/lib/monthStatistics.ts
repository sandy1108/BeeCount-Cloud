import { parseStatisticsContext, type StatisticsContext } from './statisticsContext'

export type MonthSelection = { parent: StatisticsContext; month: string }

/** 全部边界使用父快照的固定时差，刷新或跨时区访问时不按设备“今天”重算。 */
export function monthContext(parent: StatisticsContext, bucket: string): StatisticsContext | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bucket)) return null
  const [year, month] = bucket.split('-').map(Number)
  if (year < 100 || year > 9998) return null
  const offset = parent.tzOffsetMinutes * 60000
  const from = Math.max(Date.UTC(year, month - 1, 1) - offset, parent.dateFrom ? Date.parse(parent.dateFrom) : -Infinity)
  const to = Math.min(Date.UTC(year, month, 1) - offset, parent.dateTo ? Date.parse(parent.dateTo) : Infinity)
  if (from >= to) return null
  return { ...parent, dateFrom: new Date(from).toISOString(), dateTo: new Date(to).toISOString(),
    naturalMonth: true, periodLabel: `${parent.periodLabel} → ${bucket}` }
}

export function adjacentMonth(parent: StatisticsContext, bucket: string, step: -1 | 1): string | null {
  if (!monthContext(parent, bucket)) return null
  const [year, month] = bucket.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1 + step, 1)).toISOString().slice(0, 7)
  return monthContext(parent, next) ? next : null
}

/** 只补父范围交集中的日桶，保留未来空日，不把缺记录解释成现实零消费。 */
export function monthDays(context: StatisticsContext, bucket: string): string[] {
  const selected = monthContext(context, bucket)
  if (!selected) return []
  const offset = context.tzOffsetMinutes * 60000
  const start = new Date(Date.parse(selected.dateFrom!) + offset).toISOString().slice(0, 10)
  const end = new Date(Date.parse(selected.dateTo!) + offset - 1).toISOString().slice(0, 10)
  const days: string[] = []
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
    days.push(new Date(time).toISOString().slice(0, 10))
  }
  return days
}

export function parseMonthSelection(raw: string | null): MonthSelection | null {
  try {
    const value = JSON.parse(raw || 'null') as MonthSelection | null
    if (!value || typeof value.month !== 'string' || !value.parent) return null
    const parent = parseStatisticsContext(new URLSearchParams({ ledger: value.parent.ledgerId, stats: JSON.stringify(value.parent) }))
    return parent && monthContext(parent, value.month) ? { parent, month: value.month } : null
  } catch { return null }
}
