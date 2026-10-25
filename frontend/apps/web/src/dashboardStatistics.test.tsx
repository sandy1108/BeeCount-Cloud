import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { HomeHero, prepareHeroTrend } from './components/dashboard/HomeHero'
import { HomeHabitStats } from './components/dashboard/HomeHabitStats'
import { HomeMonthCategoryDonut, prepareCategoryDonut } from './components/dashboard/HomeMonthCategoryDonut'

describe('dashboard presentation', () => {
  beforeEach(() => vi.stubGlobal('window', {
    localStorage: { getItem: () => 'zh-CN' }, addEventListener: () => {}, removeEventListener: () => {},
  }))
  afterEach(() => vi.unstubAllGlobals())
  const render = (child: React.ReactNode) => renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>{child}</LocaleProvider>)
  const series = [
    { bucket: '2026-01', expense: 65, income: 100, balance: 35 },
    { bucket: '2026-02', expense: 25, income: 20, balance: -5 },
  ]
  it('changes the accumulated focus without netting income against spending or mutating inputs', () => {
    expect(prepareHeroTrend(series, 'expense').map((row) => row.v)).toEqual([65, 90])
    expect(prepareHeroTrend(series, 'balance').map((row) => row.v)).toEqual([35, 30])
    expect(series[1].income).toBe(20)
  })
  it('keeps both income and expense totals while changing the main metric', () => {
    const props = { ledgers: [], monthSummary: { income_total: 120, expense_total: 90, balance: 30, transaction_count: 4 } }
    const expense = render(<HomeHero {...props} statisticsFocus="expense" />)
    expect(expense).toContain('本月支出')
    expect(expense).toContain('本月支出走势')
    expect(expense).toContain('本月收入')
    expect(expense).toContain('120')
    expect(expense).toContain('90')
    expect(expense).not.toContain('本月结余')
    const original = render(<HomeHero {...props} />)
    expect(original).toContain('本月结余')
    expect(original).toContain('本月结余走势')
  })
  it('hides only saving rate in expense view and restores it in balance view', () => {
    const expense = render(<HomeHabitStats statisticsFocus="expense" />)
    expect(expense).not.toContain('储蓄率')
    expect(expense).toContain('日均支出')
    expect(render(<HomeHabitStats statisticsFocus="balance" />)).toContain('储蓄率')
  })
  const ranks = [100, 90, 80, 70, 60, 55, 50, 45].map((total, index) => ({
    category_name: index === 0 ? '其他' : `分类${index + 1}`, total, tx_count: index + 1,
  }))
  it('preserves all amounts and real category count including a real category named other', () => {
    const result = prepareCategoryDonut(ranks)
    expect(result.categoryCount).toBe(8)
    expect(result.slices).toHaveLength(6)
    expect(result.slices[0].isOther).toBe(false)
    expect(result.slices[5].isOther).toBe(true)
    expect(result.rest).toHaveLength(3)
    expect(result.slices[5].total).toBe(150)
    expect(result.slices[5].count).toBe(21)
    expect(result.total).toBe(550)
    expect(result.rest.map((row) => row.category_name)).toEqual(['分类6', '分类7', '分类8'])
  })
  it('renders an expandable other breakdown with amounts, full-total percentages and transaction counts', () => {
    const html = render(<HomeMonthCategoryDonut ranks={ranks} />)
    expect(html).toContain('<details')
    expect(html).toContain('其他（3个分类）')
    expect(html).toContain('分类6')
    expect(html).toContain('10.0%')
    expect(html).toContain('6笔')
    expect(html).toContain('8 个分类')
    expect(render(<HomeMonthCategoryDonut ranks={ranks.slice(0, 5)} />)).not.toContain('<details')
    expect(prepareCategoryDonut([]).total).toBe(0)
  })
  it('sorts a copy and excludes empty categories without inventing an other slice', () => {
    const input = [
      { category_name: '', total: 0, tx_count: 0 },
      { category_name: '住宿', total: 10, tx_count: 2 },
      { category_name: '雪票', total: 20, tx_count: 1 },
    ]
    const result = prepareCategoryDonut(input)
    expect(result.categoryCount).toBe(2)
    expect(result.rest).toEqual([])
    expect(result.slices.map((slice) => slice.name)).toEqual(['雪票', '住宿'])
    expect(result.total).toBe(30)
    expect(input[0].total).toBe(0)
    expect(render(<HomeMonthCategoryDonut ranks={[]} />)).not.toContain('<details')
  })
})
