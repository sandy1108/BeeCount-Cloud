import { authedDelete, authedGet, authedPost } from './http'

export type SettlementTransaction = {
  sync_id: string
  tx_type: 'expense' | 'income'
  amount: string
  currency: string
  happened_at: string
  note: string
  category_name: string | null
  exclude_from_stats: boolean
}
export type TransactionSettlement = {
  transaction_id: string
  expense: SettlementTransaction | null
  original_amount: string
  repaid_amount: string
  own_amount: string
  currency: string
  tz_offset_minutes: number | null
  season: string | null
  can_manage: boolean
  repayments: (SettlementTransaction & { relation_note: string })[]
}
export type RepaymentCandidates = {
  items: SettlementTransaction[]
  total: number
  tz_offset_minutes: number
  season: string
  remaining_amount: string
}
const path = (ledger: string, tx: string) => `/ledgers/${encodeURIComponent(ledger)}/transactions/${encodeURIComponent(tx)}`
export const fetchTransactionSettlement = (token: string, ledger: string, tx: string) =>
  authedGet<TransactionSettlement>(`/read${path(ledger, tx)}/settlement`, token)
export function fetchRepaymentCandidates(token: string, ledger: string, tx: string, offsetMinutes: number, offset = 0, q = '') {
  const query = new URLSearchParams({ tz_offset_minutes: String(offsetMinutes), offset: String(offset), limit: '20', q })
  return authedGet<RepaymentCandidates>(`/read${path(ledger, tx)}/repayment-candidates?${query}`, token)
}
export const linkRepayment = (token: string, ledger: string, expense: string, income: string, offsetMinutes: number, note: string) =>
  authedPost<TransactionSettlement>(`/write${path(ledger, expense)}/repayments`, token, { income_id: income, tz_offset_minutes: offsetMinutes, note })
export const unlinkRepayment = (token: string, ledger: string, expense: string, income: string) =>
  authedDelete<TransactionSettlement>(`/write${path(ledger, expense)}/repayments/${encodeURIComponent(income)}`, token)
