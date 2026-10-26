import { useT } from '@beecount/ui'

/** 柱子高度为零时仍可进入月份详情，同时提供键盘与触屏可操作的图表入口。 */
export function MonthDrilldownLinks({ buckets, onSelect }: { buckets: string[]; onSelect: (month: string) => void }) {
  const t = useT()
  return <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6" role="group" aria-label={t('month.select')}>
    {buckets.filter(bucket => /^\d{4}-\d{2}$/.test(bucket)).map(bucket => <button key={bucket} type="button"
      aria-label={`${t('month.open')} ${bucket}`} onClick={() => onSelect(bucket)}
      className="rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{bucket}</button>)}
  </div>
}
