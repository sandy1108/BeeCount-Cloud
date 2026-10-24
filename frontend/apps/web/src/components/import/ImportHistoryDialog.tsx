import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, useT } from '@beecount/ui'
import { getImportHistory, type ImportHistory } from '@beecount/api-client'
import { localizeError } from '../../i18n/errors'
import { formatIsoDateTimeLocal } from '../../i18n/format'
import { ImportReconciliation } from './ImportReconciliation'

/** 从持久审计读取成功报告，关闭弹窗时作废在途响应。 */
export function ImportHistoryDialog({ open, token, onClose }: { open: boolean; token: string; onClose: () => void }) {
  const t = useT()
  const [history, setHistory] = useState<ImportHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const load = useCallback(async (offset = 0) => {
    const id = ++generation.current
    setBusy(true); setError('')
    try {
      const next = await getImportHistory(token, offset)
      if (id === generation.current) setHistory(next)
    } catch (err) {
      if (id === generation.current) setError(localizeError(err, t))
    } finally { if (id === generation.current) setBusy(false) }
  }, [token, t])
  useEffect(() => { if (open) { setHistory(null); void load() }; return () => { generation.current++ } }, [open, load])
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t('import.history.title')}</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">{t('import.history.scope')}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {busy ? <p className="text-sm">{t('import.review.loading')}</p> : null}
      {history?.items.map((item) => <article key={item.id} className="space-y-3 rounded-xl border p-3">
        <div className="flex flex-wrap justify-between gap-2 text-sm font-medium">
          <span>{item.ledger_name || item.ledger_id} · {item.source_format || '—'}</span>
          <span>{formatIsoDateTimeLocal(item.created_at)} · {t('import.history.success')}</span>
        </div>
        {item.file_hash ? <p className="break-all font-mono text-[11px] text-muted-foreground">SHA256: {item.file_hash}</p> : null}
        {item.report ? <>
          <p className="text-xs">{t('import.baishi.source', { name: item.report.source_ledger_name || '—' })}</p>
          <ImportReconciliation completed amounts={item.report.amounts} currency={item.report.currency} />
        </> : <p className="text-xs text-muted-foreground">{t('import.history.legacy', { created: item.created_count, skipped: item.skipped_count })}</p>}
      </article>)}
      {history && !history.items.length ? <p className="text-sm">{t('import.history.empty')}</p> : null}
      <div className="flex justify-between gap-2">
        <Button variant="outline" size="sm" disabled={busy || !history || !history.offset} onClick={() => void load(Math.max(0, (history?.offset || 0) - 10))}>{t('import.review.previous')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load(history?.offset || 0)}>{t('import.history.refresh')}</Button>
        <Button variant="outline" size="sm" disabled={busy || !history || history.offset + history.limit >= history.total} onClick={() => history && void load(history.offset + history.limit)}>{t('import.review.next')}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
