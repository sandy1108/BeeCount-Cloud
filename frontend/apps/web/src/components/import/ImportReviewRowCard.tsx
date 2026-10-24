import { useEffect, useState } from 'react'
import { Button, Input, useT } from '@beecount/ui'
import type { ImportCandidateQuery, ImportReviewChoice, ImportReviewRow, ImportReviewTransaction } from '@beecount/api-client'
import { formatIsoDateTimeLocal } from '../../i18n/format'

/** 候选分页只控制显示；选择必须由服务端再次核验，选中项始终独立可见。 */
export function ImportReviewRowCard({ row, busy, onChoice, onCandidates }: {
  row: ImportReviewRow; busy: boolean
  onChoice: (choice: ImportReviewChoice) => void
  onCandidates: (query: ImportCandidateQuery) => void
}) {
  const t = useT()
  const [search, setSearch] = useState(row.candidate_search)
  useEffect(() => setSearch(row.candidate_search), [row.candidate_search])
  const fields = ['happened_at', 'amount', 'currency_code', 'category_name', 'account_name', 'note'] as const
  const values = (item: ImportReviewTransaction, differences: string[] = []) => <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
    {fields.map((field) => <p key={field} className={`whitespace-pre-wrap break-words rounded px-1 py-0.5 ${differences.includes(field) ? 'bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>
      <span>{t(`import.review.field.${field}`)}: </span>{field === 'happened_at' ? formatIsoDateTimeLocal(item[field]) : item[field] || '—'}
      {differences.includes(field) ? <span className="ml-1">({t('import.review.different')})</span> : null}
    </p>)}
  </div>
  return <div className={`space-y-2 rounded-xl border p-3 ${row.action === null ? 'border-primary/60' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium text-primary">{t('import.review.row', { row: row.row_number })} · {t(`import.review.${row.kind}`)}</span>
      <Button size="sm" variant={row.action === 'insert' ? 'default' : 'outline'} disabled={busy} onClick={() => onChoice({ action: 'insert' })}>
        {row.action === 'insert' ? '✓ ' : ''}{t('import.review.insert')}
      </Button>
    </div>
    <p className="text-xs font-medium">{t('import.review.incoming')} · {t(row.incoming.tx_type === 'income' ? 'import.reconcile.income' : 'import.reconcile.expense')}</p>
    {values(row.incoming)}
    {row.selected_candidate ? <div className="rounded-lg border border-primary/40 bg-primary/10 p-2">
      <p className="text-xs font-medium">✓ {t('import.review.selected')}</p>
      {values(row.selected_candidate, row.selected_candidate.differences)}
    </div> : null}
    {row.candidate_count > 0 ? <details className="rounded-lg bg-muted/30 p-2 text-xs" open={row.kind === 'review'}>
      <summary className="cursor-pointer">{t('import.review.existing', { count: row.candidate_count })}</summary>
      <p className="my-2 text-muted-foreground">{t(row.reason === 'same_file' ? 'import.review.sameFile' : row.reason === 'content' ? 'import.review.content' : row.reason === 'near_time' ? 'import.review.nearTime' : 'import.review.similar')}</p>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onCandidates({ search, offset: 0 }) }}>
        <Input className="h-8 text-xs" aria-label={t('import.review.search')} placeholder={t('import.review.search')} maxLength={200}
          value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>{t('import.review.searchButton')}</Button>
      </form>
      {row.candidates.length === 0 ? <p className="p-2">{t('import.review.noCandidates')}</p> : null}
      <div className="max-h-72 overflow-y-auto pr-1">
      {row.candidates.map((item, i) => <div key={item.sync_id} className="mt-2 space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-2">
          <span>#{row.candidate_offset + i + 1}</span>
          <Button size="sm" variant={row.action === 'skip' && row.match_id === item.sync_id ? 'default' : 'outline'} disabled={busy}
            onClick={() => onChoice({ action: 'skip', match_id: item.sync_id })}>
            {row.action === 'skip' && row.match_id === item.sync_id ? '✓ ' : ''}{t('import.review.link')}
          </Button>
        </div>
        {values(item, item.differences)}
      </div>)}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={busy || row.candidate_offset === 0}
          onClick={() => onCandidates({ search: row.candidate_search, offset: Math.max(0, row.candidate_offset - row.candidate_limit) })}>{t('import.review.previous')}</Button>
        <span>{t('import.review.page', { start: row.candidate_total ? row.candidate_offset + 1 : 0, end: Math.min(row.candidate_offset + row.candidate_limit, row.candidate_total), total: row.candidate_total })}</span>
        <Button variant="outline" size="sm" disabled={busy || row.candidate_offset + row.candidate_limit >= row.candidate_total}
          onClick={() => onCandidates({ search: row.candidate_search, offset: row.candidate_offset + row.candidate_limit })}>{t('import.review.next')}</Button>
      </div>
    </details> : null}
  </div>
}
