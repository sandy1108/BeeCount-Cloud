import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { MonthlyTrendBars } from './components/dashboard/MonthlyTrendBars'

const chart = vi.hoisted(() => ({ data: [] as Array<{ bucket: string; expense: number; income: number; balance: number }> }))
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ResponsiveContainer: Container,
    ComposedChart: ({ data, children }: { data: typeof chart.data; children?: ReactNode }) => {
      chart.data = data
      return <div>{children}</div>
    },
    Line: ({ dataKey }: { dataKey: string }) => <span data-line-key={dataKey} />,
    Bar: ({ dataKey }: { dataKey: string }) => <span data-bar-key={dataKey} />,
    CartesianGrid: () => null, Legend: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
  }
})
beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' }, addEventListener() {}, removeEventListener() {} }))
afterEach(() => vi.unstubAllGlobals())
const days = [
  { bucket: '2026-10-01', expense: 100, income: 20, balance: -80 },
  { bucket: '2026-10-02', expense: 300, income: 0, balance: -300 },
  { bucket: '2026-10-03', expense: 0, income: 500, balance: 500 },
]
const render = (focus?: 'expense' | 'balance') => renderToStaticMarkup(
  <LocaleProvider dictionaries={dictionaries}>
    <MonthlyTrendBars data={days} showAll statisticsFocus={focus} />
  </LocaleProvider>,
)

it('defaults to the positive expense trend only, preserving original cashflow data', () => {
  const html = render('expense')
  expect(html).toContain('data-line-key="expense"')
  expect(html).not.toContain('data-line-key="balance"')
  expect(html).not.toContain('data-bar-key="income"')
  expect(html).not.toContain('data-bar-key="expense"')
  expect(chart.data).toEqual(days)
  expect(chart.data[1].expense).toBeGreaterThan(chart.data[0].expense)
  expect(html).toContain('支出越高，折线越高')
})

it.each([undefined, 'balance'] as const)('preserves original net cashflow line for %s focus', focus => {
  const html = render(focus)
  expect(html).toContain('data-line-key="balance"')
  expect(chart.data).toEqual(days)
  expect(html).toContain('收入减支出')
})
