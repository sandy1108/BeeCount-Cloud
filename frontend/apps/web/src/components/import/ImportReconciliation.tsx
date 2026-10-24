import { useT } from '@beecount/ui'
import type { ImportReconciliation as Amounts } from '@beecount/api-client'

/** 始终显示整份文件口径；收入、支出分开，避免净额掩盖重复记录。 */
export function ImportReconciliation({ amounts, currency }: { amounts: Amounts; currency: string }) {
  const t = useT()
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {(['file', 'insert', 'skip', 'unresolved'] as const).map((key) => <div key={key}
      className="space-y-1 rounded-xl border bg-muted/20 p-3 text-xs">
      <p className="font-semibold">{t(`import.reconcile.${key}`)} · {t('import.reconcile.count', { count: amounts[key].count })}</p>
      <p>{t('import.reconcile.income')} <span className="font-medium">{amounts[key].income} {currency}</span></p>
      <p>{t('import.reconcile.expense')} <span className="font-medium">{amounts[key].expense} {currency}</span></p>
    </div>)}
  </div>
}
