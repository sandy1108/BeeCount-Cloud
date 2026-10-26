import { fetchWorkspaceTransactions, fetchCategoryStatistics, fetchGalleryAttachments } from '@beecount/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { statisticsLink, parseStatisticsContext, statisticsQuery, statisticsMonths } from './lib/statisticsContext'
const context = {
  ledgerId: 'ski-book', ledgerName: '合成雪季', currency: 'CNY', categoryGroup: '住宿',
  txType: 'expense' as const, dateFrom: '2025-04-30T16:00:00Z', dateTo: '2026-04-30T16:00:00Z',
  periodLabel: '25~26雪季', naturalMonth: true, tzOffsetMinutes: 480,
}
describe('statistics drilldown context', () => {
  it('round trips exact group and exclusive range without fuzzy q or ID assumptions', () => {
    const link = statisticsLink(context)
    const search = new URLSearchParams(link.split('?')[1])
    expect(search.has('q')).toBe(false)
    expect(search.get('ledger')).toBe('ski-book')
    expect(parseStatisticsContext(search)).toEqual(context)
    expect(statisticsQuery(context)).toMatchObject({
      categoryGroup: '住宿', ledgerId: 'ski-book', statisticsOnly: true,
      dateFrom: context.dateFrom, dateTo: context.dateTo, txType: 'expense',
    })
  })
  it('keeps all twelve historical buckets instead of using the current year', () => {
    expect(statisticsMonths(context)).toEqual([
      '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10',
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    ])
  })
  it('rejects broken contexts and a ledger switch rather than keeping stale ranges', () => {
    expect(parseStatisticsContext(new URLSearchParams('stats=broken'))).toBeNull()
    const params = new URLSearchParams(statisticsLink(context).split('?')[1])
    params.set('ledger', 'different')
    expect(parseStatisticsContext(params)).toBeNull()
  })
})

afterEach(() => vi.unstubAllGlobals())
it('sends the same exact filters to list, statistics and gallery', async () => {
  const urls: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    urls.push(new URL(input, 'http://localhost'))
    return new Response(JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 }))
  }))
  const query = statisticsQuery(context)
  await fetchWorkspaceTransactions('synthetic', query)
  await fetchCategoryStatistics('synthetic', { ...query, tzOffsetMinutes: 480 })
  await fetchGalleryAttachments('synthetic', query)
  for (const url of urls) {
    expect(url.searchParams.get('ledger_id')).toBe('ski-book')
    expect(url.searchParams.get('category_group')).toBe('住宿')
    expect(url.searchParams.get('statistics_only')).toBe('true')
    expect(url.searchParams.get('tx_type')).toBe('expense')
    expect(url.searchParams.get('date_from')).toBe(context.dateFrom)
    expect(url.searchParams.get('date_to')).toBe(context.dateTo)
  }
})
