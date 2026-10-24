import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardCheck, FilePlus2, Files, SearchCheck } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, useT } from '@beecount/ui'
import { ApiError, reviewImport, type ImportReview, type ImportReviewChoice } from '@beecount/api-client'
import { ImportReconciliation } from './ImportReconciliation'
import { ImportReviewRowCard } from './ImportReviewRowCard'
import type { ImportCandidateQuery } from '@beecount/api-client'
import { localizeError } from '../../i18n/errors'

interface Props {
  open: boolean
  token: string
  importToken: string
  insertAll: boolean
  onClose: () => void
  onConfirm: () => void
}

/** 核对是独立的写入前步骤；分页和选择只更新预览，最终确认才启动导入。 */
export function ImportReviewDialog({ open, token, importToken, insertAll, onClose, onConfirm }: Props) {
  const t = useT()
  const [plan, setPlan] = useState<ImportReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const filters = useRef({ unresolved: false, candidates: {} as Record<string, ImportCandidateQuery> })
  const load = useCallback(async (
    offset = 0, current?: ImportReview, decisions?: Record<string, ImportReviewChoice>, confirm = false,
  ) => {
    const requestId = ++generation.current
    setBusy(true)
    setError('')
    try {
      const next = await reviewImport(token, importToken, {
        offset, limit: 25, revision: current?.revision, decisions, confirm,
        unresolved_only: filters.current.unresolved, candidate_queries: filters.current.candidates,
      })
      if (requestId !== generation.current) return
      setPlan(next)
      if (confirm) onConfirm()
    } catch (err) {
      if (requestId !== generation.current) return
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'IMPORT_REVIEW_STALE') {
        setPlan(null)
        setError(t('import.review.stale'))
      } else if (code === 'IMPORT_REVIEW_UNRESOLVED') {
        setError(t('import.review.unresolved'))
      } else setError(localizeError(err, t))
    } finally {
      if (requestId === generation.current) setBusy(false)
    }
  }, [token, importToken, onConfirm, t])

  // 父级回调变化不应重置用户刚刚做出的选择；关闭后作废仍在途的请求。
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (open) { filters.current = { unresolved: false, candidates: {} }; setPlan(null); void loadRef.current() }
    return () => { generation.current++ }
  }, [open, importToken])

  return <Dialog open={open} onOpenChange={(value) => { if (!value && !busy) onClose() }}>
    <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-primary" />{t('import.review.title')}</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <p className="text-sm leading-relaxed text-muted-foreground">{t('import.review.description')}</p>
        {insertAll ? <p className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-sm">{t('import.review.insertAll')}</p> : null}
        {error ? <div role="alert" className="rounded-lg border border-destructive/25 p-3 text-sm text-destructive">{error}</div> : null}
        {plan ? <>
          <div className="grid grid-cols-3 gap-2">
            {(['new', 'matched', 'review'] as const).map((kind, i) => {
              const Icon = [FilePlus2, Files, SearchCheck][i]
              return <div key={kind} className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 to-background p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-4 w-4 text-primary" />{t(`import.review.${kind}`)}</div>
                <div className="mt-2 text-xl font-semibold">{plan.counts[kind]}</div>
              </div>
            })}
          </div>
          <p className="text-sm font-medium" aria-live="polite">{t('import.review.totals', plan.counts)}</p>
          <p className="text-sm font-medium">{t('import.reconcile.target', { name: plan.target.name || plan.target.ledger_id || '—', currency: plan.currency })}</p>
          <ImportReconciliation amounts={plan.amounts} currency={plan.currency} />
          <p className="text-xs text-muted-foreground">{t('import.reconcile.scope')}</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={plan.unresolved_only} disabled={busy}
              onChange={(event) => { filters.current.unresolved = event.target.checked; void load(0, plan) }} />{t('import.review.onlyUnresolved')}</label>
            <Button size="sm" variant="outline" disabled={busy || !plan.counts.unresolved}
              onClick={() => { filters.current.unresolved = true; void load(0, plan) }}>{t('import.review.nextUnresolved')}</Button>
          </div>
          <div className="space-y-3">
            {plan.items.map((row) => <ImportReviewRowCard key={row.row_number} row={row} busy={busy}
              onChoice={(choice) => void load(plan.offset, plan, { [row.row_number]: choice })}
              onCandidates={(query) => {
                filters.current.candidates = { ...filters.current.candidates, [row.row_number]: query }
                // 候选查询只需保留当前页，避免大文件翻页积累无用请求字段。
                const visible = new Set(plan.items.map((item) => String(item.row_number)))
                filters.current.candidates = Object.fromEntries(Object.entries(filters.current.candidates).filter(([key]) => visible.has(key)))
                void load(plan.offset, plan)
              }} />)}
            {!plan.items.length ? <p className="p-3 text-sm text-muted-foreground">{t('import.review.noUnresolved')}</p> : null}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <Button variant="outline" size="sm" disabled={busy || plan.offset === 0} onClick={() => void load(Math.max(0, plan.offset - 25), plan)}>{t('import.review.previous')}</Button>
            <span>{t('import.review.page', { start: plan.total ? plan.offset + 1 : 0, end: Math.min(plan.offset + plan.limit, plan.total), total: plan.total })}</span>
            <Button variant="outline" size="sm" disabled={busy || plan.offset + plan.limit >= plan.total} onClick={() => void load(plan.offset + 25, plan)}>{t('import.review.next')}</Button>
          </div>
        </> : <Button variant="outline" disabled={busy} onClick={() => void load()}>{t(busy ? 'import.review.loading' : 'import.review.reload')}</Button>}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={busy || !plan || plan.counts.unresolved > 0} onClick={() => plan && void load(plan.offset, plan, undefined, true)}>{t('import.review.confirm')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
