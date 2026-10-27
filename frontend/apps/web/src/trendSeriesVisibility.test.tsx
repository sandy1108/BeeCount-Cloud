import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { DEFAULT_TREND_VISIBILITY, toggleTrendSeries, type TrendSeriesVisibility } from './lib/trendSeriesVisibility'
import { TrendSeriesControls } from './components/dashboard/MonthlyTrendBars'

beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' }, addEventListener() {}, removeEventListener() {} }))
afterEach(() => vi.unstubAllGlobals())

it('starts with only the trend, and never switches off the last visible series', () => {
  expect(DEFAULT_TREND_VISIBILITY).toEqual({ expense: false, income: false, trend: true })
  for (let bits = 1; bits < 8; bits++) {
    const state: TrendSeriesVisibility = { expense: Boolean(bits & 1), income: Boolean(bits & 2), trend: Boolean(bits & 4) }
    for (const key of ['expense', 'income', 'trend'] as const) {
      const next = toggleTrendSeries(state, key)
      expect(Object.values(next).some(Boolean)).toBe(true)
      expect(state).toEqual({ expense: Boolean(bits & 1), income: Boolean(bits & 2), trend: Boolean(bits & 4) })
      if (state[key] && Object.values(state).filter(Boolean).length === 1) expect(next).toBe(state)
      else expect(next[key]).toBe(!state[key])
    }
  }
})

it('supports bars only, all three and independent chart instances without mutating defaults', () => {
  let first = toggleTrendSeries(DEFAULT_TREND_VISIBILITY, 'expense')
  first = toggleTrendSeries(first, 'income')
  expect(first).toEqual({ expense: true, income: true, trend: true })
  first = toggleTrendSeries(first, 'trend')
  expect(first).toEqual({ expense: true, income: true, trend: false })
  expect(DEFAULT_TREND_VISIBILITY).toEqual({ expense: false, income: false, trend: true })
})

it('exposes visible toggle states and protects the only selection for keyboard and screen readers', () => {
  const html = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
    <TrendSeriesControls visibility={DEFAULT_TREND_VISIBILITY} onToggle={() => {}} trendLabel="净额趋势" />
  </LocaleProvider>)
  expect(html).toContain('aria-label="显示内容"')
  expect(html.match(/aria-pressed="false"/g)).toHaveLength(2)
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  expect(html.match(/disabled=""/g)).toHaveLength(1)
  expect(html).toContain('净额趋势')
  expect(html).toContain('至少显示一项')
})
