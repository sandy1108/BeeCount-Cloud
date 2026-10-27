import { localizeError } from './i18n/errors'
import { ApiError } from '@beecount/api-client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { SettlementTotals, offsetLabel } from './components/dialogs/SettlementPanel'
import { fetchRepaymentCandidates, linkRepayment, unlinkRepayment, type TransactionSettlement } from '@beecount/api-client'
import { dispatchOpenDetailTx, onOpenDetailTx } from './lib/txDialogEvents'

beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' } }))
afterEach(() => vi.unstubAllGlobals())
it('shows original, recovered and personal share without relabeling cashflow totals', () => {
  const html = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}><SettlementTotals data={{
    original_amount: '3000', repaid_amount: '2250', own_amount: '750', currency: 'CNY',
  } as TransactionSettlement} /></LocaleProvider>)
  for (const text of ['原支出', '已收回', '最终承担', '3,000 CNY', '2,250 CNY', '750 CNY']) expect(html).toContain(text)
})
it('makes saved positive and negative offsets explicit', () => {
  expect(offsetLabel(480)).toBe('UTC+08:00')
  expect(offsetLabel(-420)).toBe('UTC−07:00')
  expect(offsetLabel(0)).toBe('UTC+00:00')
})
it('uses independent APIs, explicit offset, pagination and optional relation note', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init }); return new Response('{}', { status: 200 })
  }))
  await fetchRepaymentCandidates('synthetic', 'ledger/a', 'tx e', 480, 20, '住宿')
  const url = new URL(calls[0].url, 'http://test')
  expect(url.pathname).toContain('ledger%2Fa/transactions/tx%20e/repayment-candidates')
  expect(Object.fromEntries(url.searchParams)).toEqual({ tz_offset_minutes: '480', offset: '20', limit: '20', q: '住宿' })
  await linkRepayment('synthetic', 'ledger', 'expense', 'income', -420, '')
  expect(JSON.parse(calls[1].init.body as string)).toEqual({ income_id: 'income', tz_offset_minutes: -420, note: '' })
  await unlinkRepayment('synthetic', 'ledger', 'expense', 'income')
  expect(calls[2].init.method).toBe('DELETE')
  expect(calls[2].url).toContain('/repayments/income')
})
it('preserves statistics context and accepts old shared-component detail events', () => {
  const target = new EventTarget()
  vi.stubGlobal('window', target)
  const rows: unknown[] = []
  const off = onOpenDetailTx((tx, context) => rows.push([tx, context]))
  const tx = { id: 'tx', ledger_id: 'ledger' } as any
  const context = { ledgerId: 'ledger', tzOffsetMinutes: -420 } as any
  dispatchOpenDetailTx(tx, context)
  window.dispatchEvent(new CustomEvent('bee:open-detail-tx', { detail: tx }))
  off()
  expect(rows).toEqual([[tx, context], [tx, undefined]])
})

it('preserves actionable relationship conflicts in the existing edit dialog', () => {
  const error = new ApiError('请先解除关联回款', { status: 409, code: 'SETTLEMENT_CONFLICT' })
  expect(localizeError(error, key => key)).toBe('请先解除关联回款')
})
