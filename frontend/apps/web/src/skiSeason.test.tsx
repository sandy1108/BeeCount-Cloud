import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { currentSkiSeason, seasonLabel, seasonMonths, fillSeasonSeries } from './lib/skiSeason'
import { SkiSeasonControls } from './components/dashboard/SkiSeasonControls'

describe('ski season', () => {
  beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' } }))
  afterEach(() => vi.unstubAllGlobals())
  it('uses the previous starting year from January through September', () => {
    for (const month of [0, 4, 8]) expect(currentSkiSeason(new Date(2026, month, 1))).toBe(2025)
    expect(currentSkiSeason(new Date(2026, 9, 1))).toBe(2026)
  })
  it('keeps seven real cross-year months and the requested short label', () => {
    expect(seasonLabel(2025)).toBe('25~26雪季')
    expect(seasonMonths(2025)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'])
  })
  it('shows four flat common buttons and reserves history for older seasons', () => {
    const html = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
      <SkiSeasonControls scope="year" currentYear={2026} selectedYear={2024} firstYear={2023}
        onScopeChange={() => {}} onYearChange={() => {}} />
    </LocaleProvider>)
    expect(html).toContain('本月')
    expect(html).toContain('本雪季')
    expect(html).toContain('上个雪季')
    expect(html).toContain('汇总')
    expect(html).toContain('历史雪季')
    expect(html).toContain('23~24雪季')
    expect(html).toContain('24~25雪季')
    expect(html).not.toContain('今年')
    expect((html.match(/<button/g) || []).length).toBe(4)
    expect(html).not.toContain('<option value="2025"')
    expect(html).toContain('value="2024" selected')
  })
  it('selects only the previous-season button, leaving history unselected', () => {
    const html = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
      <SkiSeasonControls scope="year" currentYear={2026} selectedYear={2025} firstYear={2023}
        onScopeChange={() => {}} onYearChange={() => {}} />
    </LocaleProvider>)
    expect(html).toMatch(/aria-pressed="true"[^>]*>上个雪季/)
    expect((html.match(/aria-pressed="true"/g) || [])).toHaveLength(1)
    expect(html).toContain('value="" disabled="" selected=""')
  })
})

it('renders the historical cross-year heatmap without silently substituting the current year', async () => {
  vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' } })
  const { HomeYearHeatmap } = await import('./components/dashboard/HomeYearHeatmap')
  const html = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
    <HomeYearHeatmap buckets={seasonMonths(2023)} title="23~24雪季 · 支出分布"
      yearSeries={[{ bucket: '2024-01', expense: 100, income: 0, balance: -100 }]} />
  </LocaleProvider>)
  expect(html).toContain('2023-10')
  expect(html).toContain('2024-04')
  expect(html).toContain('2024-01')
  expect(html).not.toContain('2024-05')
  expect(html).toContain('23~24雪季')
  vi.unstubAllGlobals()
})

it('fills zero months in seasonal charts without changing recorded amounts', () => {
  const series = fillSeasonSeries(2025, [{ bucket: '2026-01', expense: 25, income: 5, balance: -20 }])
  expect(series).toHaveLength(7)
  expect(series[0]).toEqual({ bucket: '2025-10', income: 0, expense: 0, balance: 0 })
  expect(series[3].expense).toBe(25)
  expect(series.reduce((total, item) => total + item.expense, 0)).toBe(25)
})


it('keeps every daily bucket for ski-ledger month view while preserving the ordinary annual window', async () => {
  const { prepareTrendSeries } = await import('./components/dashboard/MonthlyTrendBars')
  const days = Array.from({ length: 31 }, (_, i) => ({
    bucket: `2026-01-${String(i + 1).padStart(2, '0')}`,
    expense: i + 1, income: 0, balance: -(i + 1),
  }))
  const full = prepareTrendSeries(days, true)
  expect(full).toHaveLength(31)
  expect(full[0].bucket).toBe('2026-01-01')
  expect(full.reduce((sum, row) => sum + row.expense, 0)).toBe(496)
  expect(prepareTrendSeries(days)).toHaveLength(12)
})
