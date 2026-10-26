import { describe, expect, it } from 'vitest'
import { monthContext, monthDays, adjacentMonth, parseMonthSelection } from './lib/monthStatistics'
import { parseStatisticsContext, statisticsLink, statisticsQuery } from './lib/statisticsContext'

const parent = {
  ledgerId: 'ski', ledgerName: '合成雪季', currency: 'CNY', txType: 'cashflow' as const,
  dateFrom: '2023-04-30T16:00:00Z', dateTo: '2024-04-30T16:00:00Z',
  periodLabel: '23~24雪季', naturalMonth: true, tzOffsetMinutes: 480,
}
describe('month drilldown range', () => {
  it('uses the original offset, keeps income and expense, and survives a URL round trip', () => {
    const context = monthContext(parent, '2024-02')!
    expect(context.dateFrom).toBe('2024-01-31T16:00:00.000Z')
    expect(context.dateTo).toBe('2024-02-29T16:00:00.000Z')
    expect(statisticsQuery(context)).toMatchObject({ txType: 'cashflow', statisticsOnly: true })
    expect(statisticsQuery(context).categoryGroup).toBeUndefined()
    expect(parseStatisticsContext(new URLSearchParams(statisticsLink(context).split('?')[1]))).toEqual(context)
    expect(monthDays(context, '2024-02')).toHaveLength(29)
  })
  it.each([['2023-06', 30], ['2023-12', 31], ['2024-02', 29]])('fills the full days in %s', (bucket, count) => {
    expect(monthDays(monthContext(parent, bucket)!, bucket)).toHaveLength(count)
  })
  it('clamps a partial month without silently widening its parent range', () => {
    const partial = { ...parent, dateTo: '2024-02-15T16:00:00Z', categoryGroup: '住宿', txType: 'expense' as const }
    const context = monthContext(partial, '2024-02')!
    expect(context.dateTo).toBe('2024-02-15T16:00:00.000Z')
    expect(context.categoryGroup).toBe('住宿')
    expect(context.txType).toBe('expense')
    expect(monthDays(context, '2024-02')).toHaveLength(15)
  })
  it('keeps next-year January and stops at the selected May-to-April boundaries', () => {
    expect(adjacentMonth(parent, '2023-12', 1)).toBe('2024-01')
    expect(adjacentMonth(parent, '2023-05', -1)).toBeNull()
    expect(adjacentMonth(parent, '2024-04', 1)).toBeNull()
    expect(monthContext(parent, '2024-05')).toBeNull()
    expect(monthContext(parent, '2024-13')).toBeNull()
    expect(monthContext(parent, 'bad')).toBeNull()
  })
  it('restores the immutable parent on refresh and rejects invalid month deep links', () => {
    const raw = JSON.stringify({ parent, month: '2023-11' })
    expect(parseMonthSelection(raw)).toEqual({ parent, month: '2023-11' })
    expect(parseMonthSelection(JSON.stringify({ parent, month: '2022-11' }))).toBeNull()
    expect(parseMonthSelection(JSON.stringify({ parent: { ...parent, tzOffsetMinutes: 9999 }, month: '2023-11' }))).toBeNull()
    expect(parseMonthSelection('{')).toBeNull()
  })
})
