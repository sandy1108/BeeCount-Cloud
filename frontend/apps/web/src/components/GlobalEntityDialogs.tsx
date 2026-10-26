import { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  fetchWorkspaceTags,
  fetchCategoryStatistics,
  type CategoryStatistics,
  fetchWorkspaceTransactions,
  type WorkspaceAccount,
  type WorkspaceCategory,
  type WorkspaceTag,
  type WorkspaceTransaction,
} from '@beecount/api-client'

import { useAttachmentPreview } from '../context/AttachmentPreviewContext'
import { useAttachmentCache } from '../context/AttachmentCacheContext'
import { useAuth } from '../context/AuthContext'
import { useLedgers } from '../context/LedgersContext'
import {
  dispatchOpenEditCategory,
  dispatchOpenEditTx,
  onOpenDetailAccount,
  onOpenDetailCategory,
  onOpenDetailTag,
  onOpenDetailTx,
  type DetailScope,
} from '../lib/txDialogEvents'
import { statisticsLink, statisticsQuery, statisticsMonths, type StatisticsContext } from '../lib/statisticsContext'
import { useSyncRefresh } from '../context/SyncSocketContext'
import { AccountDetailDialog } from './dialogs/AccountDetailDialog'
import { CategoryDetailDialog } from './dialogs/CategoryDetailDialog'
import { TagDetailDialog } from './dialogs/TagDetailDialog'
import { TransactionDetailDialog } from './dialogs/TransactionDetailDialog'

const DETAIL_PAGE_SIZE = 50
/**
 * 全局实体详情弹窗容器 — 监听 4 类 detail 事件,在 AppShell 顶层渲染对应弹窗。
 *
 * 之前各 *Page 自己管自己的详情弹窗,导致跨页打开(例如 health 页点 sample
 * 想看交易详情)必须先跳到目标页才能渲染,体验割裂。
 *
 * 集中管理后:
 *  - 任意页点 dispatchOpenDetailX(entity) → 弹窗在当前页面就开
 *  - tx detail 是轻量(只展示字段)直接渲染
 *  - account / category / tag 的弹窗内部带交易列表,这里在事件触发时
 *    懒拉对应交易数据
 *  - 详情 → 编辑链路:点编辑按钮 → 跳到对应 page + 派发 openEditX 事件,
 *    page 端的编辑弹窗接管
 */
export function GlobalEntityDialogs() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const { activeLedgerId, currentLedger, currency: activeCurrency } = useLedgers()
  const { previewMap: iconPreviewByFileId, resolvePreview } = useAttachmentCache()
  const previewAttachment = useAttachmentPreview()

  // 4 个独立 state — 互不影响,可同时打开(不太可能但理论支持)
  const [tx, setTx] = useState<WorkspaceTransaction | null>(null)

  const [account, setAccount] = useState<WorkspaceAccount | null>(null)
  const [accountScope, setAccountScope] = useState<DetailScope>('current')
  const [accountTxs, setAccountTxs] = useState<WorkspaceTransaction[]>([])
  const [accountTotal, setAccountTotal] = useState(0)
  const [accountOffset, setAccountOffset] = useState(0)
  const [accountLoading, setAccountLoading] = useState(false)

  const [category, setCategory] = useState<WorkspaceCategory | null>(null)
  const [categoryScope, setCategoryScope] = useState<DetailScope>('current')
  const [categoryTxs, setCategoryTxs] = useState<WorkspaceTransaction[]>([])
  const [categoryTotal, setCategoryTotal] = useState(0)
  const [categoryOffset, setCategoryOffset] = useState(0)
  const [categoryLoading, setCategoryLoading] = useState(false)
  // Stats 批量数据 — 跟 categoryScope 联动:current 限当前账本,all 跨账本。
  const [categoryStatsLoading, setCategoryStatsLoading] = useState(false)
  const [categoryContext, setCategoryContext] = useState<StatisticsContext | undefined>()
  const [categoryServerStats, setCategoryServerStats] = useState<CategoryStatistics | null>(null)
  const [categoryError, setCategoryError] = useState(false)
  const categoryRequest = useRef(0)
  const closeCategory = useCallback(() => { categoryRequest.current++; setCategory(null) }, [])
  useEffect(() => { closeCategory() }, [activeLedgerId, closeCategory])

  const [tag, setTag] = useState<WorkspaceTag | null>(null)
  const [tagScope, setTagScope] = useState<DetailScope>('current')
  const [tagTxs, setTagTxs] = useState<WorkspaceTransaction[]>([])
  const [tagTotal, setTagTotal] = useState(0)
  const [tagOffset, setTagOffset] = useState(0)
  const [tagLoading, setTagLoading] = useState(false)

  // 共享 tags 字典 — 4 个详情弹窗里 TransactionList 渲染 tag chip 都要
  const [tagsDict, setTagsDict] = useState<WorkspaceTag[]>([])

  // 监听 tx detail
  useEffect(() => {
    return onOpenDetailTx((next) => {
      setTx(next)
      // 顺手拉一份 tags 字典,详情弹窗里的 tag chip 要按 color 渲染
      if (tagsDict.length === 0) {
        void fetchWorkspaceTags(token, { limit: 500 })
          .then(setTagsDict)
          .catch(() => undefined)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const loadAccountTxs = useCallback(
    async (accountName: string, scope: DetailScope, offset: number) => {
      setAccountLoading(true)
      try {
        const page = await fetchWorkspaceTransactions(token, {
          accountName,
          ledgerId: scope === 'current' ? activeLedgerId || undefined : undefined,
          limit: DETAIL_PAGE_SIZE,
          offset,
        })
        setAccountTxs((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
        setAccountTotal(page.total)
        setAccountOffset(offset + page.items.length)
      } catch {
        // 静默,弹窗里展示空 list 即可
      } finally {
        setAccountLoading(false)
      }
    },
    [token, activeLedgerId],
  )

  // 监听 account detail
  useEffect(() => {
    return onOpenDetailAccount((acc, defaultScope) => {
      setAccount(acc)
      setAccountScope(defaultScope)
      setAccountTxs([])
      setAccountTotal(0)
      setAccountOffset(0)
      void loadAccountTxs(acc.name, defaultScope, 0)
      // 同时拉一份 tags 字典(如还没拉)
      if (tagsDict.length === 0) {
        void fetchWorkspaceTags(token, { limit: 500 }).then(setTagsDict).catch(() => undefined)
      }
    })
  }, [loadAccountTxs, token, tagsDict.length])

  const handleAccountScopeChange = useCallback(
    (next: DetailScope) => {
      if (!account || next === accountScope) return
      setAccountScope(next)
      setAccountTxs([])
      setAccountTotal(0)
      setAccountOffset(0)
      void loadAccountTxs(account.name, next, 0)
    },
    [account, accountScope, loadAccountTxs],
  )

  const loadCategoryTxs = useCallback(
    async (categorySyncId: string, scope: DetailScope, offset: number, context?: StatisticsContext) => {
      const request = categoryRequest.current
      setCategoryLoading(true)
      try {
        const page = await fetchWorkspaceTransactions(token, {
          categorySyncId: context ? undefined : categorySyncId,
          ...(context ? statisticsQuery(context) : {}),
          ledgerId: context?.ledgerId ?? (scope === 'current' ? activeLedgerId || undefined : undefined),
          limit: DETAIL_PAGE_SIZE,
          offset,
        })
        if (request !== categoryRequest.current) return
        setCategoryTxs((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
        setCategoryTotal(page.total)
        setCategoryOffset(offset + page.items.length)
      } catch {
        if (request === categoryRequest.current) setCategoryError(true)
      } finally {
        if (request === categoryRequest.current) setCategoryLoading(false)
      }
    },
    [token, activeLedgerId],
  )

  /** 完整聚合由后端计算，不以分页或前1000笔作为统计样本。 */
  const loadCategoryStats = useCallback(
    async (categorySyncId: string, scope: DetailScope, context?: StatisticsContext) => {
      const request = categoryRequest.current
      setCategoryStatsLoading(true)
      setCategoryServerStats(null)
      try {
        const stats = await fetchCategoryStatistics(token, {
          categorySyncId: context ? undefined : categorySyncId,
          ledgerId: scope === 'current' ? activeLedgerId || undefined : undefined,
          ...(context ? statisticsQuery(context) : {}),
          tzOffsetMinutes: context?.tzOffsetMinutes ?? -new Date().getTimezoneOffset(),
          naturalMonth: context?.naturalMonth,
        })
        if (request === categoryRequest.current) setCategoryServerStats(stats)
      } catch {
        if (request === categoryRequest.current) setCategoryError(true)
      } finally {
        if (request === categoryRequest.current) setCategoryStatsLoading(false)
      }
    }, [token, activeLedgerId],
  )

  // 监听 category detail
  useEffect(() => {
    return onOpenDetailCategory((cat, defaultScope, context) => {
      categoryRequest.current++
      setCategoryContext(context)
      setCategoryError(false)
      setCategory(cat)
      setCategoryScope(defaultScope)
      setCategoryTxs([])
      setCategoryTotal(0)
      setCategoryOffset(0)
      void loadCategoryTxs(cat.id, defaultScope, 0, context)
      void loadCategoryStats(cat.id, defaultScope, context)
      if (tagsDict.length === 0) {
        void fetchWorkspaceTags(token, { limit: 500 }).then(setTagsDict).catch(() => undefined)
      }
    })
  }, [loadCategoryTxs, loadCategoryStats, token, tagsDict.length])

  const handleCategoryScopeChange = useCallback(
    (next: DetailScope) => {
      if (!category || categoryContext || next === categoryScope) return
      categoryRequest.current++
      setCategoryError(false)
      setCategoryScope(next)
      setCategoryTxs([])
      setCategoryTotal(0)
      setCategoryOffset(0)
      void loadCategoryTxs(category.id, next, 0)
      void loadCategoryStats(category.id, next)
    },
    [category, categoryScope, categoryContext, loadCategoryTxs, loadCategoryStats],
  )

  useSyncRefresh(() => {
    if (!category) return
    categoryRequest.current++
    setCategoryError(false)
    void loadCategoryTxs(category.id, categoryScope, 0, categoryContext)
    void loadCategoryStats(category.id, categoryScope, categoryContext)
  })

  const loadTagTxs = useCallback(
    async (tagSyncId: string, scope: DetailScope, offset: number) => {
      setTagLoading(true)
      try {
        const page = await fetchWorkspaceTransactions(token, {
          tagSyncId,
          ledgerId: scope === 'current' ? activeLedgerId || undefined : undefined,
          limit: DETAIL_PAGE_SIZE,
          offset,
        })
        setTagTxs((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
        setTagTotal(page.total)
        setTagOffset(offset + page.items.length)
      } catch {
        // ignore
      } finally {
        setTagLoading(false)
      }
    },
    [token, activeLedgerId],
  )

  // 监听 tag detail
  useEffect(() => {
    return onOpenDetailTag((nextTag, defaultScope) => {
      setTag(nextTag)
      setTagScope(defaultScope)
      setTagTxs([])
      setTagTotal(0)
      setTagOffset(0)
      void loadTagTxs(nextTag.id, defaultScope, 0)
      if (tagsDict.length === 0) {
        void fetchWorkspaceTags(token, { limit: 500 }).then(setTagsDict).catch(() => undefined)
      }
    })
  }, [loadTagTxs, token, tagsDict.length])

  const handleTagScopeChange = useCallback(
    (next: DetailScope) => {
      if (!tag || next === tagScope) return
      setTagScope(next)
      setTagTxs([])
      setTagTotal(0)
      setTagOffset(0)
      void loadTagTxs(tag.id, next, 0)
    },
    [tag, tagScope, loadTagTxs],
  )

  // 详情 → 编辑:派发事件到 GlobalEditDialogs(任何页都挂载,事件总能被
  // 接住,无需跳页)。Category 编辑暂时还要 fallback 跳页(分类编辑表单
  // 依赖 inline icon picker,数据流复杂,后续单独全局化)。
  const handleEditTx = useCallback(
    (target: WorkspaceTransaction) => {
      setTx(null)
      dispatchOpenEditTx(target)
    },
    [],
  )

  const handleEditCategory = useCallback(
    (cat: WorkspaceCategory) => {
      setCategory(null)
      dispatchOpenEditCategory(cat)
    },
    [],
  )

  const handleJumpToTransactions = useCallback(
    (cat: WorkspaceCategory) => {
      if (categoryContext) {
        closeCategory()
        navigate(statisticsLink(categoryContext))
        return
      }
      const scopeAtJump = categoryScope
      setCategory(null)
      // 跳过去的 TransactionsPage ledger filter 跟当前 scope 对齐:current
      // 时带 ledger=...,all 时不限制账本,避免用户切到「全部账本」却跳进单
      // 账本列表造成迷惑。
      const params = new URLSearchParams()
      params.set('q', cat.name)
      if (scopeAtJump === 'current' && activeLedgerId) {
        params.set('ledger', activeLedgerId)
      }
      navigate(`/app/transactions?${params.toString()}`)
    },
    [navigate, activeLedgerId, categoryScope, categoryContext, closeCategory],
  )

  return (
    <>
      <TransactionDetailDialog
        tx={tx}
        tags={tagsDict}
        onClose={() => setTx(null)}
        onEdit={handleEditTx}
      />
      <AccountDetailDialog
        account={account}
        scope={accountScope}
        onScopeChange={handleAccountScopeChange}
        transactions={accountTxs}
        total={accountTotal}
        offset={accountOffset}
        loading={accountLoading}
        tags={tagsDict}
        onPreviewAttachment={previewAttachment}
        resolveAttachmentPreviewUrl={ref => resolvePreview(ref.cloudFileId || '')}
        onClose={() => setAccount(null)}
        onLoadMore={(name, off) => void loadAccountTxs(name, accountScope, off)}
      />
      <CategoryDetailDialog
        onPreviewAttachment={previewAttachment}
        category={category}
        scope={categoryScope}
        onScopeChange={handleCategoryScopeChange}
        currency={categoryContext?.currency ?? activeCurrency}
        statsTransactions={[]}
        serverStats={categoryServerStats}
        statisticsContext={categoryContext}
        statsError={categoryError}
        onRetry={() => {
          if (!category) return
          categoryRequest.current++
          setCategoryError(false)
          void loadCategoryTxs(category.id, categoryScope, 0, categoryContext)
          void loadCategoryStats(category.id, categoryScope, categoryContext)
        }}
        trendBuckets={categoryContext ? statisticsMonths(categoryContext) : undefined}
        statsLoading={categoryStatsLoading}
        statsTruncated={false}
        transactions={categoryTxs}
        total={categoryTotal}
        offset={categoryOffset}
        loading={categoryLoading}
        tags={tagsDict}
        iconPreviewUrlByFileId={iconPreviewByFileId}
        ledgerMonthStartDay={categoryContext?.naturalMonth ? 1 : currentLedger?.month_start_day ?? 1}
        onClose={closeCategory}
        onLoadMore={(syncId, off) => void loadCategoryTxs(syncId, categoryScope, off, categoryContext)}
        canManage={!categoryContext}
        onEdit={handleEditCategory}
        onJumpToTransactions={handleJumpToTransactions}
      />
      <TagDetailDialog
        tag={tag}
        scope={tagScope}
        onScopeChange={handleTagScopeChange}
        transactions={tagTxs}
        total={tagTotal}
        offset={tagOffset}
        loading={tagLoading}
        tags={tagsDict}
        tagStatsById={{}}
        onPreviewAttachment={previewAttachment}
        resolveAttachmentPreviewUrl={ref => resolvePreview(ref.cloudFileId || '')}
        onClose={() => setTag(null)}
        onLoadMore={(syncId, off) => void loadTagTxs(syncId, tagScope, off)}
      />
    </>
  )
}
