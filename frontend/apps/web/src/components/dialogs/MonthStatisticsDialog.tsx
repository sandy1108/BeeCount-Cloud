import { dispatchOpenDetailTx } from '../../lib/txDialogEvents'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, useT } from '@beecount/ui'
import { Amount, TransactionList } from '@beecount/web-features'
import { downloadWorkspaceTransactionsCsv, fetchMonthStatistics, fetchWorkspaceTransactions, type MonthStatistics, type WorkspaceTransaction, type WorkspaceTransactionPage } from '@beecount/api-client'
import { useAuth } from '../../context/AuthContext'
import { useLedgers } from '../../context/LedgersContext'
import { useSyncRefresh } from '../../context/SyncSocketContext'
import { useAttachmentPreview } from '../../context/AttachmentPreviewContext'
import { adjacentMonth, monthContext, monthDays, parseMonthSelection, type MonthSelection } from '../../lib/monthStatistics'
import { statisticsLink, statisticsQuery, statisticsRangeLabel } from '../../lib/statisticsContext'
import { MonthlyTrendBars } from '../dashboard/MonthlyTrendBars'
import { HomeMonthCategoryDonut } from '../dashboard/HomeMonthCategoryDonut'

const PAGE_SIZE = 20

/** 月份选择和父范围留在URL；关闭仅移除子范围，原首页/分类弹窗及滚动位置不重建。 */
export function MonthStatisticsDialog({ onReturnToParent }: { onReturnToParent: (selection: MonthSelection) => void }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const raw = location.pathname === '/app/overview' ? params.get('monthStats') : null
  const selection = useMemo(() => parseMonthSelection(raw), [raw])
  const context = useMemo(() => selection ? monthContext(selection.parent, selection.month) : null, [selection])
  const { token, profileMe } = useAuth()
  const { activeLedgerId, ledgers, setActiveLedgerId } = useLedgers()
  const preview = useAttachmentPreview()
  const [pageState, setPage] = useState({ raw, index: 0 })
  const page = pageState.raw === raw ? pageState.index : 0
  const [refresh, setRefresh] = useState(0)
  const key = `${raw}:${page}:${refresh}:${token}`
  const [result, setResult] = useState<{ key: string; stats: MonthStatistics; transactions: WorkspaceTransactionPage } | null>(null)
  const [error, setError] = useState('')
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const selectedRaw = useRef<string | null>(null)
  const exportScope = useRef(raw)
  exportScope.current = raw
  const clear = useCallback(() => {
    const next = new URLSearchParams(params); next.delete('monthStats')
    setParams(next, { replace: true })
  }, [params, setParams])

  // 深链先选择可见账本；用户随后主动换账本，则退出旧月份而非切回旧账本。
  useEffect(() => {
    if (!selection) { selectedRaw.current = null; return }
    if (!ledgers.some(ledger => ledger.ledger_id === selection.parent.ledgerId)) return
    if (selectedRaw.current !== raw) {
      selectedRaw.current = raw
      setActiveLedgerId(selection.parent.ledgerId)
    } else if (activeLedgerId !== selection.parent.ledgerId) clear()
  }, [selection, raw, ledgers, activeLedgerId, setActiveLedgerId, clear])

  useEffect(() => {
    if (!context || context.ledgerId !== activeLedgerId) return
    let cancelled = false
    setExportState('idle')
    void Promise.all([
      fetchMonthStatistics(token, { ...statisticsQuery(context), dateFrom: context.dateFrom!, dateTo: context.dateTo!, tzOffsetMinutes: context.tzOffsetMinutes }),
      fetchWorkspaceTransactions(token, { ...statisticsQuery(context), limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    ]).then(([stats, transactions]) => {
      if (!cancelled) setResult({ key, stats, transactions })
    }).catch(() => { if (!cancelled) setError(key) })
    return () => { cancelled = true }
  }, [context, activeLedgerId, token, page, refresh, key])
  useSyncRefresh(() => setRefresh(value => value + 1))

  const close = () => { clear(); if (selection) onReturnToParent(selection) }
  const changeMonth = (month: string) => {
    if (!selection) return
    const next = new URLSearchParams(params)
    next.set('monthStats', JSON.stringify({ ...selection, month }))
    setParams(next, { replace: true })
  }
  const ready = result?.key === key && context?.ledgerId === activeLedgerId
  const failed = error === key || Boolean(selection && !ledgers.some(ledger => ledger.ledger_id === selection.parent.ledgerId))
  const current = ready ? result : null
  const stats = current?.stats
  const days = context && selection ? monthDays(context, selection.month) : []
  const daily = new Map(stats?.daily.map(item => [item.bucket, item]))
  const series = days.map(bucket => daily.get(bucket) ?? { bucket, expense: 0, income: 0, balance: 0 })
  const previous = selection ? adjacentMonth(selection.parent, selection.month, -1) : null
  const next = selection ? adjacentMonth(selection.parent, selection.month, 1) : null

  return <Dialog open={Boolean(raw)} onOpenChange={open => { if (!open) close() }}>
    <DialogContent aria-describedby={context ? 'month-statistics-description' : undefined} className="flex max-h-[90vh] w-[calc(100%_-_2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border/60 bg-gradient-to-br from-primary/10 to-transparent px-5 py-4 pr-12">
        <DialogTitle>{t('month.title')}{selection ? ` · ${selection.month}` : ''}</DialogTitle>
        {context && <p id="month-statistics-description" className="break-words text-xs text-muted-foreground">{statisticsRangeLabel(context)}{context.categoryGroup !== undefined ? ` · ${context.categoryGroup}` : ''} · {t(`enum.txType.${context.txType}`)} · {t('statistics.basis')}</p>}
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={close}>{t('month.back')}</Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!previous} onClick={() => previous && changeMonth(previous)}>{t('month.previous')}</Button>
            <Button size="sm" variant="outline" disabled={!next} onClick={() => next && changeMonth(next)}>{t('month.next')}</Button>
          </div>
        </div>
        {!selection || !context ? <p role="alert">{t('month.invalid')}</p> : failed ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{t('statistics.failed')}</span><Button size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>{t('statistics.retry')}</Button></div> : !stats || !current ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">{t('ski.loading')}</p> : <>
          <MonthSummary stats={stats} currency={context.currency} expenseFocus={profileMe?.statistics_focus === 'expense'} />
          <MonthlyTrendBars data={series} showAll title={t('month.daily')} statisticsFocus={profileMe?.statistics_focus} />
          <p className="text-xs text-muted-foreground">{t('statistics.trendHint')}</p>
          {context.categoryGroup === undefined ? <div className="grid gap-4 md:grid-cols-2">
            <HomeMonthCategoryDonut ranks={stats.expenseCategories} currency={context.currency} title={t('ski.categories')} />
            <HomeMonthCategoryDonut ranks={stats.incomeCategories} currency={context.currency} title={t('month.incomeCategories')} kind="income" />
          </div> : <div className="grid gap-4 sm:grid-cols-2">
            <MonthNamedList title={t('detail.category.topAccounts')} rows={stats.topAccounts} currency={context.currency} />
            <MonthNamedList title={t('detail.category.topTags')} rows={stats.topTags} currency={context.currency} />
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
            <span className="text-sm font-semibold">{t('month.transactions')} · {stats.summary.count}{t('home.topCat.countUnit')}</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={exportState === 'busy'} onClick={async () => {
                setExportState('busy')
                try { await downloadWorkspaceTransactionsCsv(token, { ...statisticsQuery(context), tzOffsetMinutes: context.tzOffsetMinutes }); if (exportScope.current === raw) setExportState('done') }
                catch { if (exportScope.current === raw) setExportState('error') }
              }}>{t('month.export')}</Button>
              <Button size="sm" variant="outline" onClick={() => navigate(statisticsLink(context, '/app/attachments'))}>{t('statistics.attachments')}</Button>
              <Button size="sm" onClick={() => navigate(statisticsLink(context))}>{t('detail.category.viewAll')}</Button>
            </div>
          </div>
          {exportState === 'done' && <p role="status" className="text-xs text-muted-foreground">{t('month.exported')}</p>}
          {exportState === 'error' && <p role="alert" className="text-xs text-destructive">{t('month.exportError')}</p>}
          <TransactionList onSelect={row => dispatchOpenDetailTx(row as WorkspaceTransaction, context ?? undefined)} items={current.transactions.items} variant="compact" onPreviewAttachment={preview} noteDisplayMode={profileMe?.appearance?.note_display_mode ?? 'category'} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('month.page').replace('{page}', String(page + 1)).replace('{pages}', String(Math.max(1, Math.ceil(current.transactions.total / PAGE_SIZE))))} · {current.transactions.total}{t('home.topCat.countUnit')}</span>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={!page} onClick={() => setPage({ raw, index: page - 1 })}>{t('month.previousPage')}</Button><Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= current.transactions.total} onClick={() => setPage({ raw, index: page + 1 })}>{t('month.nextPage')}</Button></div>
          </div>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}

export function MonthSummary({ stats, currency, expenseFocus }: { stats: MonthStatistics; currency: string; expenseFocus: boolean }) {
  const t = useT()
  const metrics = expenseFocus ? ['expense', 'income', 'balance'] as const : ['balance', 'expense', 'income'] as const
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
    {metrics.map(metric => <div key={metric} className="min-w-0 rounded-xl border border-border/60 bg-muted/20 p-3"><p className="mb-1 text-xs text-muted-foreground">{t(`home.trendBars.${metric}`)}</p><Amount value={stats.summary[metric]} currency={currency} compact={false} size="md" bold tone={metric === 'expense' ? 'negative' : metric === 'income' ? 'positive' : 'default'} /></div>)}
    <div className="min-w-0 rounded-xl border border-border/60 bg-muted/20 p-3"><p className="mb-1 text-xs text-muted-foreground">{t('detail.stats.txCount')}</p><span className="font-mono text-xl font-bold">{stats.summary.count}</span></div>
  </div>
}

function MonthNamedList({ title, rows, currency }: { title: string; rows: MonthStatistics['topAccounts']; currency: string }) {
  const t = useT()
  return <div className="rounded-xl border border-border/60 p-3"><h3 className="mb-2 text-sm font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{t('month.breakdownHint')}</p>{!rows.length ? <p className="py-4 text-xs text-muted-foreground">{t('detail.category.topEmpty')}</p> : <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto">{rows.map(row => <li key={row.name} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 break-words">{row.name} · {row.count}{t('home.topCat.countUnit')}</span><Amount value={row.amount} currency={currency} compact={false} size="xs" /></li>)}</ul>}</div>
}
