import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { MonthSummary } from './components/dialogs/MonthStatisticsDialog'
import { HomeMonthCategoryDonut } from './components/dashboard/HomeMonthCategoryDonut'
import { MonthDrilldownLinks } from './components/dashboard/MonthDrilldownLinks'
import { HomeYearHeatmap } from './components/dashboard/HomeYearHeatmap'
import { statisticsMonths } from './lib/statisticsContext'
import { monthContext } from './lib/monthStatistics'
import { fetchMonthStatistics, fetchWorkspaceTransactions, fetchGalleryAttachments } from '@beecount/api-client'

beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' }, addEventListener() {}, removeEventListener() {} }))
afterEach(() => vi.unstubAllGlobals())
const render = (child: React.ReactNode) => renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>{child}</LocaleProvider>)
const parent = { ledgerId: 'ski', ledgerName: '合成', currency: 'CNY', txType: 'cashflow' as const,
  dateFrom: '2026-04-30T16:00:00Z', dateTo: '2027-04-30T16:00:00Z', tzOffsetMinutes: 480,
  periodLabel: '26~27雪季', naturalMonth: true }
it('keeps income, expense, balance and full count visible in both presentation focuses', () => {
  const stats = { summary: { expense: 1234.56, income: 200, balance: -1034.56, count: 1005 }, daily: [], expenseCategories: [], incomeCategories: [], topAccounts: [], topTags: [] }
  for (const expenseFocus of [true, false]) {
    const html = render(<MonthSummary stats={stats} currency="CNY" expenseFocus={expenseFocus} />)
    expect(html).toContain('1,234.56')
    expect(html).toContain('200')
    expect(html).toContain('1,034.56')
    expect(html).toContain('1005')
    expect(html).toContain('收入')
    expect(html).toContain('支出')
  }
  expect(render(<MonthSummary stats={{ ...stats, summary: { income: 0, expense: 0, balance: 0, count: 0 } }} currency="CNY" expenseFocus />)).toContain('>0</span>')
})
it('offers all twelve month buttons including empty and future months', () => {
  const buckets = statisticsMonths(parent)!
  const html = render(<MonthDrilldownLinks buckets={buckets} onSelect={() => {}} />)
  expect(html.match(/<button/g)).toHaveLength(12)
  expect(html).toContain('查看月份 2026-05')
  expect(html).toContain('查看月份 2027-04')
  expect(html).not.toContain('disabled')
  const heatmap = render(<HomeYearHeatmap yearSeries={[]} buckets={buckets} onMonthClick={() => {}} />)
  expect(heatmap.match(/role="button"/g)).toHaveLength(12)
  expect(heatmap).toContain('未到期')
})
it('sends identical month boundaries and cashflow filters to summary, pagination and gallery', async () => {
  const urls: URL[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    urls.push(new URL(input, 'http://test'))
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const context = monthContext(parent, '2026-10')!
  const options = { ledgerId: context.ledgerId, dateFrom: context.dateFrom!, dateTo: context.dateTo!, txType: context.txType, statisticsOnly: true, tzOffsetMinutes: 480 }
  await fetchMonthStatistics('synthetic', options)
  await fetchWorkspaceTransactions('synthetic', { ...options, limit: 20, offset: 1000 })
  await fetchGalleryAttachments('synthetic', options)
  for (const { searchParams: p } of urls) {
    expect(p.get('tx_type')).toBe('cashflow')
    expect(p.get('ledger_id')).toBe('ski')
    expect(p.get('date_from')).toBe('2026-09-30T16:00:00.000Z')
    expect(p.get('date_to')).toBe('2026-10-31T16:00:00.000Z')
    expect(p.has('category_group')).toBe(false)
  }
})

it('labels empty income and income breakdown as income rather than expense', () => {
  const empty = render(<HomeMonthCategoryDonut ranks={[]} title="收入分类" kind="income" />)
  expect(empty).toContain('所选周期暂无收入记录')
  expect(empty).not.toContain('暂无支出')
  const income = render(<HomeMonthCategoryDonut ranks={Array.from({ length: 6 }, (_, i) => ({ category_name: `收入${i}`, total: 100 - i, tx_count: 1 }))} title="收入分类" kind="income" />)
  expect(income).toContain('以全部收入为分母')
  expect(income).not.toContain('以全部支出为分母')
})
