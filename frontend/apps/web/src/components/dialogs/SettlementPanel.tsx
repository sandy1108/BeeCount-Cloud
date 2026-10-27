import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, useT } from '@beecount/ui'
import {
  fetchRepaymentCandidates, fetchTransactionSettlement, fetchWorkspaceTransactions, linkRepayment, unlinkRepayment,
  type RepaymentCandidates, type SettlementTransaction, type TransactionSettlement, type WorkspaceTransaction,
} from '@beecount/api-client'
import { Link2, Plus, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useSyncEvent, useSyncRefresh } from '../../context/SyncSocketContext'
import { dispatchOpenDetailTx } from '../../lib/txDialogEvents'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const format = (amount: string, currency: string) => `${Number(amount).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} ${currency}`
export const offsetLabel = (offset: number) => `UTC${offset < 0 ? '−' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`

/** 展示原流水和额外净承担，绝不把回款混进首页/分类的收支口径。 */
export function SettlementTotals({ data }: { data: TransactionSettlement }) {
  const t = useT()
  return <div className="grid grid-cols-3 gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
    {([['settlement.original', data.original_amount], ['settlement.received', data.repaid_amount], ['settlement.own', data.own_amount]] as const).map(([label, amount]) =>
      <div key={label} className="min-w-0"><p className="text-[11px] text-muted-foreground">{t(label)}</p><p className="mt-1 break-words text-sm font-semibold tabular-nums">{format(amount, data.currency)}</p></div>)}
  </div>
}

export function SettlementPanel({ tx, tzOffsetMinutes }: { tx: WorkspaceTransaction; tzOffsetMinutes?: number }) {
  const t = useT()
  const { token } = useAuth()
  const ledger = tx.ledger_id || ''
  const [data, setData] = useState<TransactionSettlement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [candidates, setCandidates] = useState<RepaymentCandidates | null>(null)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SettlementTransaction | null>(null)
  const [note, setNote] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const generation = useRef(0)
  const offset = data?.tz_offset_minutes ?? tzOffsetMinutes ?? -new Date().getTimezoneOffset()

  const reload = useCallback(async () => {
    const request = ++generation.current
    setLoading(true); setError('')
    try {
      const next = await fetchTransactionSettlement(token, ledger, tx.id)
      if (request === generation.current) setData(next)
    } catch (err) { if (request === generation.current) { setData(null); setError(message(err)) } }
    finally { if (request === generation.current) setLoading(false) }
  }, [token, ledger, tx.id])
  useEffect(() => { void reload(); return () => { generation.current++ } }, [reload])
  useSyncRefresh(() => { void reload() })
  useSyncEvent('repayment_change', event => { if ('ledgerId' in event && event.ledgerId === ledger) { setChoosing(false); setSelected(null); void reload() } })
  useSyncEvent('member_change', () => { setChoosing(false); void reload() })
  // WS断线不意味着关系不变；重新聚焦时取服务端权威状态。
  useEffect(() => {
    const focus = () => { if (!document.hidden) { setChoosing(false); void reload() } }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus) }
  }, [reload])

  useEffect(() => {
    if (!choosing || !data?.can_manage) return
    let live = true
    setCandidateLoading(true); setCandidateError(''); setCandidates(null); setSelected(null)
    void fetchRepaymentCandidates(token, ledger, tx.id, offset, page * 20, query)
      .then(result => { if (live) setCandidates(result) })
      .catch(err => { if (live) setCandidateError(message(err)) })
      .finally(() => { if (live) setCandidateLoading(false) })
    return () => { live = false }
  }, [token, ledger, tx.id, offset, page, query, choosing, data?.can_manage])

  const change = async (action: () => Promise<TransactionSettlement>) => {
    setBusy(true); setError('')
    try {
      const result = await action()
      setData(result); setChoosing(false); setSelected(null); setRemoving(null); setNote('')
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }
  const openRelated = async (sid: string) => {
    setBusy(true); setError('')
    try {
      const page = await fetchWorkspaceTransactions(token, { ledgerId: ledger, txSyncId: sid, limit: 1 })
      if (!page.items[0]) throw new Error(t('settlement.missing'))
      dispatchOpenDetailTx(page.items[0])
    } catch (err) { setError(message(err)) }
    finally { setBusy(false) }
  }

  return <section aria-label={t('settlement.title')} className="space-y-3 border-b border-border/60 px-6 py-4">
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-sm font-semibold"><Link2 className="h-4 w-4 text-primary" />{t('settlement.title')}</h3>
      {data?.can_manage && tx.tx_type === 'expense' && tx.amount > 0 && <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => { setChoosing(!choosing); setPage(0); setSelected(null) }}><Plus className="mr-1 h-3 w-3" />{t('settlement.add')}</Button>}</div>
    {loading ? <p role="status" className="text-xs text-muted-foreground">{t('settlement.loading')}</p> : null}
    {error && <div role="alert" className="space-y-2 text-xs text-destructive"><p>{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>{t('statistics.retry')}</Button></div>}
    {data && !loading && <>
      {data.expense ? <>
        {tx.tx_type === 'income' && <button type="button" disabled={busy} className="block text-left text-xs text-primary underline" onClick={() => void openRelated(data.expense!.sync_id)}>{t('settlement.parent')} · {data.expense.note || data.expense.category_name || t('settlement.original')}</button>}
        <SettlementTotals data={data} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t('settlement.basis')}</p>
        {data.tz_offset_minutes !== null && <p className="text-[11px] text-muted-foreground">{data.season?.slice(-2)}~{String(Number(data.season) + 1).slice(-2)}{t('settlement.season')} · {offsetLabel(data.tz_offset_minutes)} · {t('settlement.frozen')}</p>}
        {data.expense.exclude_from_stats && <p className="text-xs text-muted-foreground">{t('settlement.excludedExpense')}</p>}
        {data.repayments.length === 0 && <p className="text-xs text-muted-foreground">{t('settlement.empty')}</p>}
        <div className="space-y-2">{data.repayments.map(row => <div key={row.sync_id} className="rounded-lg border border-border/60 p-3 text-xs">
          <div className="flex items-start justify-between gap-2"><button type="button" disabled={busy} onClick={() => void openRelated(row.sync_id)} className="min-w-0 text-left hover:underline"><span className="font-medium text-income">+{format(row.amount, row.currency)}</span><p className="mt-1 break-words">{row.note || row.category_name || t('settlement.income')}</p></button>
            {data.can_manage && <Button size="sm" variant="ghost" aria-label={t('settlement.unlink')} disabled={busy} onClick={() => setRemoving(row.sync_id)}><X className="h-3 w-3" /></Button>}</div>
          <p className="mt-1 text-muted-foreground">{tx.tx_type === 'income' && row.sync_id === tx.id ? `${t('settlement.currentIncome')} · ` : ''}{row.relation_note || t('settlement.title')} · {new Date(row.happened_at).toLocaleDateString()}</p>
          {row.exclude_from_stats && <p className="mt-1 text-muted-foreground">{t('settlement.excludedIncome')}</p>}
          {removing === row.sync_id && <div className="mt-2 space-y-2"><p>{t('settlement.unlinkHint')}</p><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void change(() => unlinkRepayment(token, ledger, data.expense!.sync_id, row.sync_id))}>{t('settlement.confirmUnlink')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>{t('dialog.cancel')}</Button></div></div>}
        </div>)}</div>
      </> : <p className="text-xs text-muted-foreground">{tx.tx_type === 'income' ? t('settlement.independent') : t('settlement.positive')}</p>}
      {!data.can_manage && <p className="text-xs text-muted-foreground">{t('settlement.readonly')}</p>}
      {choosing && data.can_manage && <div className="space-y-3 rounded-xl border border-primary/30 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">{t('settlement.rules')} · {offsetLabel(offset)}</p>
        <form className="flex gap-2" onSubmit={event => { event.preventDefault(); setPage(0); setQuery(search.trim()) }}>
          <input aria-label={t('settlement.search')} placeholder={t('settlement.search')} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} />
          <Button size="sm" variant="outline" type="submit" disabled={busy}>{t('settlement.searchButton')}</Button>
        </form>
        {candidateLoading && <p role="status" className="text-xs">{t('settlement.loading')}</p>}
        {candidateError && <p role="alert" className="text-xs text-destructive">{candidateError}</p>}
        {candidates && <>
          <p className="text-xs text-muted-foreground">{t('settlement.available')} {candidates.total} · {t('settlement.remaining')} {format(candidates.remaining_amount, data.currency)}</p>
          {candidates.total === 0 && <p className="text-xs text-muted-foreground">{t('settlement.noCandidates')}</p>}
          {candidates.items.map(row => <button type="button" key={row.sync_id} disabled={busy} aria-pressed={selected?.sync_id === row.sync_id} onClick={() => setSelected(row)} className={`block w-full rounded-lg border p-2.5 text-left text-xs ${selected?.sync_id === row.sync_id ? 'border-primary bg-primary/10 ring-1 ring-primary' : 'border-border/60 hover:bg-muted/30'}`}>
            <span className="font-medium">+{format(row.amount, row.currency)}</span> · {new Date(row.happened_at).toLocaleDateString()}<p className="mt-1 break-words text-muted-foreground">{row.note || row.category_name || t('settlement.income')}{row.exclude_from_stats ? ` · ${t('settlement.excludedIncome')}` : ''}</p>
          </button>)}
          <div className="flex justify-between gap-2"><Button size="sm" variant="ghost" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>{t('month.previousPage')}</Button><Button size="sm" variant="ghost" disabled={busy || (page + 1) * 20 >= candidates.total} onClick={() => setPage(page + 1)}>{t('month.nextPage')}</Button></div>
        </>}
        {selected && <div className="space-y-2 border-t border-border/60 pt-3">
          <label className="block text-xs">{t('settlement.note')}<input className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-xs" maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
          <div className="flex flex-wrap gap-1">{['refund', 'reimburse', 'share'].map(key => <Button key={key} size="sm" variant="ghost" disabled={busy} onClick={() => setNote(t(`settlement.${key}`))}>{t(`settlement.${key}`)}</Button>)}</div>
          <Button size="sm" className="w-full" disabled={busy} onClick={() => void change(() => linkRepayment(token, ledger, tx.id, selected.sync_id, offset, note))}>{t('settlement.confirmLink')}</Button>
        </div>}
      </div>}
    </>}
  </section>
}
