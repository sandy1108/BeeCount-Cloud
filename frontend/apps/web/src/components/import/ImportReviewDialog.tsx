import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardCheck, FilePlus2, Files, SearchCheck } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, useT } from '@beecount/ui'
import { ApiError, reviewImport, type ImportReview, type ImportReviewChoice } from '@beecount/api-client'
import { formatIsoDateTimeLocal } from '../../i18n/format'
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
  const load = useCallback(async (
    offset = 0, current?: ImportReview, decisions?: Record<string, ImportReviewChoice>, confirm = false,
  ) => {
    const requestId = ++generation.current
    setBusy(true)
    setError('')
    try {
      const next = await reviewImport(token, importToken, {
        offset, limit: 25, revision: current?.revision, decisions, confirm,
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
    if (open) { setPlan(null); void loadRef.current() }
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
          <div className="space-y-3">
            {plan.items.map((row) => <div key={row.row_number} className="space-y-2 rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-primary">{t('import.review.row', { row: row.row_number })} · {t(`import.review.${row.kind}`)}</span>
                <select
                  className="h-9 max-w-full rounded-lg border bg-background px-2 text-sm"
                  aria-label={t('import.review.choice', { row: row.row_number })}
                  disabled={busy}
                  value={row.action === 'skip' ? `skip:${row.match_id}` : row.action || ''}
                  onChange={(event) => {
                    const value = event.target.value
                    if (!value) return
                    const choice: ImportReviewChoice = value === 'insert' ? { action: 'insert' }
                      : { action: 'skip', match_id: value.slice(5) }
                    void load(plan.offset, plan, { [row.row_number]: choice })
                  }}
                >
                  <option value="" disabled>{t('import.review.pick')}</option>
                  <option value="insert">{t('import.review.insert')}</option>
                  {row.candidates.map((item, i) => <option key={item.sync_id} value={`skip:${item.sync_id}`}>
                    {t('import.review.skipCandidate', { index: i + 1 })}
                  </option>)}
                </select>
              </div>
              <p className="text-sm">{formatIsoDateTimeLocal(row.incoming.happened_at)} · {row.incoming.tx_type === 'income' ? '+' : '−'}{row.incoming.amount} · {row.incoming.category_name || '—'} · {row.incoming.account_name || '—'}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{row.incoming.note || '—'}</p>
              {row.candidates.length ? <details className="rounded-lg bg-muted/40 p-2 text-xs" open={row.kind === 'review'}>
                <summary className="cursor-pointer">{t('import.review.existing', { count: row.candidate_count })}</summary>
                <p className="mt-2 text-muted-foreground">{t(row.reason === 'same_file' ? 'import.review.sameFile' : row.reason === 'content' ? 'import.review.content' : 'import.review.similar')}</p>
                {row.candidates.map((item, i) => <div key={item.sync_id} className="mt-2 whitespace-pre-wrap break-words border-t pt-2">
                  #{i + 1} · {formatIsoDateTimeLocal(item.happened_at)} · {item.amount} · {item.category_name || '—'} · {item.account_name || '—'}<br />{item.note || '—'}
                </div>)}
                {row.candidate_count > row.candidates.length ? <p className="mt-2">{t('import.review.candidateLimit')}</p> : null}
              </details> : null}
            </div>)}
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
