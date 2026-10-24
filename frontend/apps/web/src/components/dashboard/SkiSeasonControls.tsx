import { useT } from '@beecount/ui'
import { seasonLabel, type DashboardScope } from '../../lib/skiSeason'

interface Props {
  scope: DashboardScope
  currentYear: number
  selectedYear: number
  firstYear: number
  onScopeChange: (scope: DashboardScope) => void
  onYearChange: (year: number) => void
}

/** 常用周期平铺；历史雪季单独选择，不把历史范围误标成“本雪季”。 */
export function SkiSeasonControls({ scope, currentYear, selectedYear, firstYear, onScopeChange, onYearChange }: Props) {
  const t = useT()
  const historical = scope === 'year' && selectedYear !== currentYear
  const years = Array.from({ length: Math.max(0, currentYear - firstYear) }, (_, i) => currentYear - i - 1)
  return <div className="flex flex-wrap items-center gap-2">
    <div className="inline-flex rounded-lg border border-border/60 bg-background/60 p-1" role="group" aria-label={t('ski.period')}>
      {(['month', 'year', 'all'] as const).map((value) => {
        const active = scope === value && !historical
        return <button key={value} type="button" aria-pressed={active}
          onClick={() => onScopeChange(value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {value === 'year' ? t('ski.current') : t(`home.scope.${value}`)}
        </button>
      })}
    </div>
    <select aria-label={t('ski.history')} value={historical ? String(selectedYear) : ''}
      className={`h-9 max-w-full rounded-lg border px-2 text-xs ${historical ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 bg-background/60 text-muted-foreground'}`}
      onChange={(event) => { if (event.target.value) onYearChange(Number(event.target.value)) }}>
      <option value="" disabled>{t('ski.history')}</option>
      {years.map((year) => <option key={year} value={year}>{seasonLabel(year, t('ski.suffix'))}</option>)}
    </select>
  </div>
}
