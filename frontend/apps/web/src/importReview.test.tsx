import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { getImportHistory, reviewImport, type ImportReviewRow } from '@beecount/api-client'
import { dictionaries } from './i18n'
import { ImportReviewRowCard } from './components/import/ImportReviewRowCard'
import { ImportReconciliation } from './components/import/ImportReconciliation'

describe('import review experience', () => {
  beforeEach(() => vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' } }))
  afterEach(() => vi.unstubAllGlobals())

  it('keeps server decimal strings and separates file, inserted, skipped and unresolved totals', () => {
    const markup = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
      <ImportReconciliation currency="MOP" amounts={{
        file: { count: 3, expense: '9007199254740993.10', income: '0' },
        insert: { count: 1, expense: '0.10', income: '0' },
        skip: { count: 1, expense: '9007199254740992.90', income: '0' },
        unresolved: { count: 1, expense: '0.10', income: '0' },
      }} />
    </LocaleProvider>)
    expect(markup).toContain('9007199254740993.10')
    expect(markup).toContain('尚待确认')
    expect(markup).toContain('MOP')
  })

  it('keeps a selected record visible even when the current search returns no candidates', () => {
    const tx = { tx_type: 'expense', amount: '1.20', currency_code: 'USD', happened_at: '2026-01-02T10:00:00Z', note: 'source', category_name: null, account_name: null }
    const row: ImportReviewRow = {
      row_number: 4, kind: 'review', reason: 'similar', action: 'skip', match_id: 'selected', incoming: tx,
      candidates: [], selected_candidate: { ...tx, sync_id: 'selected', note: 'Changed existing note', differences: ['note'] },
      candidate_count: 30, candidate_total: 0, candidate_offset: 0, candidate_limit: 20, candidate_search: 'missing',
    }
    const markup = renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
      <ImportReviewRowCard row={row} busy={false} onChoice={() => {}} onCandidates={() => {}} />
    </LocaleProvider>)
    expect(markup).toContain('已选择跳过')
    expect(markup).toContain('Changed existing note')
    expect(markup).toContain('与来源不同')
    expect(markup).toContain('没有符合搜索条件的候选')
  })

  it('sends filter and candidate paging without dropping the review revision or decision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const options = { revision: 'rev', unresolved_only: true, offset: 25, candidate_queries: { '4': { offset: 20, search: 'lunch' } }, decisions: { '4': { action: 'skip' as const, match_id: 'existing' } } }
    await reviewImport('secret', 'import-key', options)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(options)
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
  })

  it('loads authenticated history with an explicit page offset', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    await getImportHistory('secret', 10)
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/import/history?offset=10&limit=10')
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret')
  })
})
