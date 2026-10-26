import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, useT } from '@beecount/ui'

import type { WorkspaceAnalyticsCategoryRank } from '@beecount/api-client'
import { Amount } from '@beecount/web-features'

interface Props {
  /** 本月支出类别排行（scope=month&metric=expense 返回的 category_ranks）。 */
  ranks: WorkspaceAnalyticsCategoryRank[]
  currency?: string
  title?: string
  kind?: 'expense' | 'income'
  onSelectCategory?: (name: string) => void
}

/** 固定展示金额前五，其余合并；保留原行供展开，不用名称判断合并项。 */
export function prepareCategoryDonut(ranks: WorkspaceAnalyticsCategoryRank[]) {
  const sorted = ranks.slice().filter((row) => row.total > 0).sort((a, b) => b.total - a.total)
  const rest = sorted.slice(5)
  const slices = sorted.slice(0, 5).map((row) => ({
    name: row.category_name, total: row.total, count: row.tx_count, isOther: false,
  }))
  if (rest.length) slices.push({
    name: '', total: rest.reduce((sum, row) => sum + row.total, 0),
    count: rest.reduce((sum, row) => sum + row.tx_count, 0), isOther: true,
  })
  return { slices, rest, categoryCount: sorted.length, total: sorted.reduce((sum, row) => sum + row.total, 0) }
}

/**
 * 本月支出分类占比环。SVG conic-gradient 做分段，Top 5 各一段，之外合并为
 * "其他"。参考 `AccountsPanel.AssetsCompositionMini`，同样风格避免引入 recharts
 * 分段饼图的多余依赖。
 */
export function HomeMonthCategoryDonut({ ranks, currency = 'CNY', title, kind = 'expense', onSelectCategory }: Props) {
  const t = useT()
  const otherLabel = t('home.monthDonut.other')
  const { slices, rest, total, categoryCount } = useMemo(() => prepareCategoryDonut(ranks), [ranks])

  // 配色：前 5 用 BeeCount mobile 常用调色盘，"其他"用中性灰
  const PALETTE = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#a855f7']
  const OTHER_COLOR = '#94a3b8'

  const conic = useMemo(() => {
    if (total <= 0) return 'hsl(var(--muted))'
    let acc = 0
    const stops: string[] = []
    slices.forEach((s, i) => {
      const color = s.isOther ? OTHER_COLOR : PALETTE[i % PALETTE.length]
      const start = (acc / total) * 100
      acc += s.total
      const end = (acc / total) * 100
      stops.push(`${color} ${start.toFixed(3)}% ${end.toFixed(3)}%`)
    })
    return `conic-gradient(from -90deg, ${stops.join(',')})`
  }, [slices, total])

  return (
    <Card className="bc-panel overflow-hidden">
      <CardHeader className="flex flex-row items-end justify-between">
        <CardTitle className="text-base">{title || t('home.monthDonut.title')}</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          {t('home.monthDonut.total')}{' '}
          <Amount
            value={total}
            currency={currency}
            size="xs"
            tone={kind === 'income' ? 'positive' : 'negative'}
            bold
            className="inline"
          />
        </span>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            {kind === 'income' ? t('month.noIncome') : title ? t('ski.noExpense') : t('home.monthDonut.empty')}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative h-40 w-40 shrink-0">
              <div
                className="absolute inset-0 rounded-full"
                style={{ background: conic }}
                aria-hidden
              />
              <div className="absolute inset-[18%] rounded-full bg-card" aria-hidden />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {kind === 'income' ? t('month.incomeCategories') : title ? t('ski.categories') : t('home.monthDonut.center')}
                </div>
                <Amount
                  value={total}
                  currency={currency}
                  size="sm"
                  bold
                  tone={kind === 'income' ? 'positive' : 'negative'}
                  className="mt-0.5"
                />
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {t('home.monthDonut.categoryCount').replace('{count}', String(categoryCount))}
                </div>
              </div>
            </div>
            <ul className="min-w-[150px] flex-1 space-y-1.5">
              {slices.map((s, i) => {
                const color =
                  s.isOther ? OTHER_COLOR : PALETTE[i % PALETTE.length]
                const pct = total > 0 ? (s.total / total) * 100 : 0
                return (
                  <li key={`${s.name}-${i}`} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <button type="button" disabled={s.isOther || !onSelectCategory} onClick={() => onSelectCategory?.(s.name)} className="flex-1 truncate text-left enabled:hover:underline enabled:focus-visible:ring-2 enabled:focus-visible:ring-ring" title={s.isOther ? otherLabel : s.name}>
                      {s.isOther ? t('home.monthDonut.otherCount').replace('{count}', String(rest.length)) : s.name || t('home.monthDonut.uncategorized')}
                    </button>
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                    <Amount
                      value={s.total}
                      currency={currency}
                      size="xs"
                      className="w-20 text-right"
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        {rest.length > 0 && <details className="group mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-foreground">
            {t('home.monthDonut.otherDetails').replace('{count}', String(rest.length))}
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">{t(kind === 'income' ? 'month.incomeOtherHint' : 'home.monthDonut.otherHint')}</p>
          <ul className="mt-3 space-y-2">
            {rest.map((row, index) => <li key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <button type="button" disabled={!onSelectCategory} onClick={() => onSelectCategory?.(row.category_name)} className="min-w-0 flex-1 break-words text-left enabled:hover:underline enabled:focus-visible:ring-2 enabled:focus-visible:ring-ring">{row.category_name || t('home.monthDonut.uncategorized')}</button>
              <span className="text-muted-foreground">{t('home.monthDonut.txCount').replace('{count}', String(row.tx_count))}</span>
              <span className="font-mono text-muted-foreground">{(row.total / total * 100).toFixed(1)}%</span>
              <Amount value={row.total} currency={currency} size="xs" className="w-20 text-right" />
            </li>)}
          </ul>
        </details>}
      </CardContent>
    </Card>
  )
}
