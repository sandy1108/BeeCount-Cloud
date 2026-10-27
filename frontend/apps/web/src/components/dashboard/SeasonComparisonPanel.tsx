import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bar, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'
import { Button, Card, CardContent, CardHeader, CardTitle, useT } from '@beecount/ui'
import { Amount } from '@beecount/web-features'
import { fetchSeasonComparison, type SeasonComparison, type SeasonComparisonSide } from '@beecount/api-client'
import { useAuth } from '../../context/AuthContext'
import { useLedgers } from '../../context/LedgersContext'
import { useSyncRefresh } from '../../context/SyncSocketContext'
import { currentSkiSeason, seasonLabel } from '../../lib/skiSeason'
import { comparisonBarMonth, comparisonCategories, comparisonContext, comparisonDelta, comparisonMonths, defaultComparisonCutoff, defaultComparisonMode, localDateAtOffset, patchComparisonSettings, type ComparisonMetric } from '../../lib/seasonComparison'
import { dispatchOpenDetailCategory } from '../../lib/txDialogEvents'

const inputClass = 'min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm'

/** 比较设置持久化在首页URL，子分类/月弹窗仅增加参数，关闭/刷新保留比较口径。 */
export function SeasonComparisonPanel({ season, firstTxAt }: { season: number; firstTxAt?: string | null }) {
  const t = useT()
  const { token, profileMe } = useAuth()
  const { activeLedgerId, currentLedger, currency } = useLedgers()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{key: string; value: SeasonComparison} | null>(null)
  const [error, setError] = useState('')
  const open = params.get('compare') === '1'
  const scopeKey = `${activeLedgerId}:${season}`
  const settings = params.has('compareFor') && params.get('compareFor') !== scopeKey ? new URLSearchParams() : params
  const rawOffset = settings.get('compareOffset')
  const offset = rawOffset !== null && Number.isInteger(Number(rawOffset)) && Number(rawOffset) >= -720 && Number(rawOffset) <= 840 ? Number(rawOffset) : -new Date().getTimezoneOffset()
  const today = localDateAtOffset(new Date(), offset)
  const rawYear = Number(settings.get('compareYear'))
  const other = Number.isInteger(rawYear) && rawYear >= 100 && rawYear <= 9998 && rawYear !== season ? rawYear : season - 1
  const mode = settings.get('compareMode') === 'full' ? 'full' : settings.get('compareMode') === 'same' ? 'same' : defaultComparisonMode(season, today)
  const cutoff = settings.get('compareCutoff') ?? defaultComparisonCutoff(season, today)
  const metricRaw = settings.get('compareMetric')
  const metric: ComparisonMetric = metricRaw === 'income' || metricRaw === 'expense' || metricRaw === 'balance' ? metricRaw : profileMe?.statistics_focus === 'expense' ? 'expense' : 'balance'
  const categoryKind = settings.get('compareCategory') === 'income' ? 'income' : 'expense'
  const cumulative = settings.get('compareCumulative') === '1'
  const key = JSON.stringify([activeLedgerId,season,other,mode,mode === 'same' ? cutoff : '',offset,token,refresh])
  const change = (values: Record<string,string>) => {
    // 用地址栏最新参数合并：快速连续切换不依赖尚未重渲染的旧params。
    const next = patchComparisonSettings(new URLSearchParams(window.location.search), scopeKey,
      {compareCutoff:cutoff, compareMode:mode, compareYear:String(other), compareOffset:String(offset)}, values)
    setParams(next,{preventScrollReset:true})
  }
  useEffect(()=>{
    if (open && params.get('compareFor') !== scopeKey) change({compare:'1'})
  },[open,scopeKey,params.get('compareFor')])
  useEffect(()=>{
    if (!open || !activeLedgerId) return
    let cancelled = false
    setError('')
    void fetchSeasonComparison(token,{ledgerId:activeLedgerId,season,compareSeason:other,mode,
      cutoff:mode === 'same' && cutoff ? cutoff : undefined,tzOffsetMinutes:offset})
      .then(value=>{if(!cancelled)setResult({key,value})})
      .catch(()=>{if(!cancelled)setError(key)})
    return ()=>{cancelled=true}
  },[open,activeLedgerId,season,other,mode,cutoff,offset,token,refresh,key])
  useSyncRefresh(()=>setRefresh(v=>v+1))
  const data = result?.key === key ? result.value : null
  const label = (side: SeasonComparisonSide) => seasonLabel(side.range.year,t('ski.suffix'))
  const ledger = {ledgerId:activeLedgerId!,ledgerName:currentLedger?.ledger_name ?? '',currency}
  const category = (side: SeasonComparisonSide,name:string) => {
    if (side.range.empty_period) return
    const context = comparisonContext(side,ledger,offset,{name,kind:categoryKind})
    dispatchOpenDetailCategory({id:'__statistics_group__',name,kind:categoryKind,level:1,sort_order:null,icon:null,
      icon_type:null,parent_name:null,last_change_id:0,ledger_id:activeLedgerId,ledger_name:ledger.ledgerName,
      created_by_user_id:null,created_by_email:null},{defaultScope:'current',statisticsContext:context})
  }
  const month = (side: SeasonComparisonSide,bucket:string) => {
    const next = new URLSearchParams(params)
    next.set('monthStats',JSON.stringify({parent:comparisonContext(side,ledger,offset),month:bucket}))
    navigate({search:`?${next}`},{preventScrollReset:true})
  }
  const firstYear = firstTxAt ? currentSkiSeason(new Date(firstTxAt)) : season - 1
  const oldest = Math.min(currentSkiSeason() - 11, season - 1, firstYear)
  const years = Array.from(new Set([other,...Array.from({length:Math.max(12,currentSkiSeason()-oldest+1)},(_,i)=>currentSkiSeason()-i)]))
    .filter(year=>year!==season && year>=100).sort((a,b)=>b-a)
  const rows = data ? comparisonMonths(data.selected,data.comparison,metric,cumulative) : []
  const categories = data ? comparisonCategories(data.selected[categoryKind === 'income' ? 'incomeCategories':'expenseCategories'],data.comparison[categoryKind === 'income'?'incomeCategories':'expenseCategories']) : []
  const canToday = today >= `${season}-05-01` && today <= `${season+1}-04-30`
  return <Card className="overflow-hidden border-primary/20">
    <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent py-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-lg">{t('compare.title')}</CardTitle>
        <Button size="sm" variant="outline" aria-expanded={open} onClick={()=>change({compare:open?'0':'1'})}>{t(open?'compare.close':'compare.open')}</Button></div>
      <p className="text-sm leading-relaxed text-muted-foreground">{t('compare.hint')}</p>
    </CardHeader>
    {open && <CardContent className="space-y-6 pt-5">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t('compare.other')}<select aria-label={t('compare.other')} className={inputClass} value={other} onChange={e=>change({compareYear:e.target.value})}>{years.map(year=><option key={year} value={year}>{seasonLabel(year,t('ski.suffix'))}</option>)}</select></label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">{t('compare.mode')}<select aria-label={t('compare.mode')} className={inputClass} value={mode} onChange={e=>change({compareMode:e.target.value})}><option value="same">{t('compare.same')}</option><option value="full">{t('compare.full')}</option></select></label>
        {mode==='same' && <><label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">{t('compare.cutoff')}<input aria-label={t('compare.cutoff')} className={inputClass} type="date" min={`${season}-05-01`} max={today < `${season+1}-04-30` ? today : `${season+1}-04-30`} value={cutoff} onChange={e=>change({compareCutoff:e.target.value})}/></label>{canToday && <Button size="sm" variant="outline" onClick={()=>change({compareCutoff:today})}>{t('compare.today')}</Button>}</>}
      </div>
      {error===key ? <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{t('statistics.failed')}<Button size="sm" variant="outline" onClick={()=>setRefresh(v=>v+1)}>{t('statistics.retry')}</Button></div> : !data ? <p role="status" className="py-8 text-sm text-muted-foreground">{t('ski.loading')}</p> : <>
        <div className="grid gap-3 sm:grid-cols-2">{[data.selected,data.comparison].map(side=><div key={side.range.year} className="min-w-0 rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="flex items-center gap-2 text-base font-semibold"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${side === data.selected ? 'bg-primary' : 'bg-teal-600'}`} />{label(side)}{mode==='full' && side.range.not_ended ? ` · ${t('compare.unfinished')}`:''}</p>
          <p className="mt-1.5 break-words text-sm text-muted-foreground">{side.range.start_date} → {side.range.end_date ?? '—'} · {currency}</p>
          {side.range.empty_period && <p role="status" className="mt-2 text-xs">{t('compare.noDays')}</p>}
          {side.range.includes_today && <p className="mt-2 text-xs text-amber-600">{t('compare.todayOpen')}</p>}
          {side.range.leap_adjusted && <p className="mt-2 text-xs text-muted-foreground">{t('compare.leap')}</p>}
        </div>)}</div>
        <p className="text-xs text-muted-foreground">{t('statistics.basis')} · {t('enum.txType.cashflow')}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([metric,...(['expense','income','balance'] as const).filter(m=>m!==metric),'count'] as const).map(m=><ComparisonSummary key={m} metric={m} data={data} currency={currency}/>)}</div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/50 bg-muted/20 p-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">{t('compare.metric')}<select aria-label={t('compare.metric')} className={inputClass} value={metric} onChange={e=>change({compareMetric:e.target.value})}>{(['expense','income','balance'] as const).map(m=><option key={m} value={m}>{t(`home.trendBars.${m}`)}</option>)}</select></label>
          <Button size="sm" variant={cumulative?'default':'outline'} aria-pressed={cumulative} onClick={()=>change({compareCumulative:cumulative?'0':'1'})}>{t('compare.cumulative')}</Button>
        </div>
        <div className="h-72 min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{left:0,right:8,top:8,bottom:0}}>
          <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="month" tick={{fontSize:12}}/><YAxis width={54} tick={{fontSize:12}}/><Tooltip formatter={(value,name)=>[`${Number(value).toLocaleString()} ${currency}`,name]} labelFormatter={value=>`${value}${rows.find(row=>row.month===String(value))?.partial ? ` · ${t('compare.partial')}` : ''}`}/><Legend wrapperStyle={{fontSize:14}}/>
          {cumulative ? <><Line type="linear" connectNulls={false} dataKey="selected" name={label(data.selected)} stroke="hsl(var(--primary))"/><Line type="linear" connectNulls={false} dataKey="comparison" name={label(data.comparison)} stroke="#0d9488"/></> : <><Bar cursor="pointer" onClick={entry=>{const bucket=comparisonBarMonth(entry,'selected');if(bucket)month(data.selected,bucket)}} dataKey="selected" name={label(data.selected)} fill="hsl(var(--primary))" radius={[3,3,0,0]}/><Bar cursor="pointer" onClick={entry=>{const bucket=comparisonBarMonth(entry,'comparison');if(bucket)month(data.comparison,bucket)}} dataKey="comparison" name={label(data.comparison)} fill="#0d9488" radius={[3,3,0,0]}/></>}
        </ComposedChart></ResponsiveContainer></div>
        <p className="text-xs text-muted-foreground">{t('compare.monthHint')}</p>
        <div className="overflow-x-auto rounded-xl border border-border/60"><table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr><th className="p-3">{t('compare.month')}</th><th className="p-3">{label(data.selected)}</th><th className="p-3">{label(data.comparison)}</th></tr></thead><tbody>{rows.map(row=><tr key={row.bucket} className="border-t border-border/40"><th className="whitespace-nowrap p-3 font-normal">{row.month}{row.partial?` · ${t('compare.partial')}`:''}</th>{([['selected',data.selected,row.bucket],['comparison',data.comparison,row.other]] as const).map(([key,side,bucket])=><td key={key} className="p-3">{row[key]===null ? <span className="text-muted-foreground">—</span> : <button className="text-left underline decoration-dotted underline-offset-4" onClick={()=>month(side,bucket)} aria-label={`${label(side)} ${bucket} ${t('month.open')}`}><Amount value={row[key]!} currency={currency} compact={false} size="md"/></button>}</td>)}</tr>)}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">{t('compare.categories')}</h3><select aria-label={t('compare.categoryKind')} className={inputClass} value={categoryKind} onChange={e=>change({compareCategory:e.target.value})}><option value="expense">{t('enum.txType.expense')}</option><option value="income">{t('enum.txType.income')}</option></select></div>
        {!categories.length ? <p className="py-4 text-xs text-muted-foreground">{t('compare.empty')}</p> : <div className="overflow-x-auto rounded-xl border border-border/60"><table className="w-full text-left text-sm"><thead className="bg-muted/40"><tr><th className="p-3">{t('compare.category')}</th><th className="p-3">{label(data.selected)}</th><th className="p-3">{label(data.comparison)}</th><th className="p-3">{t('compare.difference')}</th></tr></thead><tbody>{categories.map(row=><tr key={row.name} className="border-t border-border/40"><th className="p-3 font-normal"><span className="break-words">{row.name}</span>{(!row.selected || !row.comparison) && <span className="mt-1 block text-xs text-muted-foreground">{t(row.selected?'compare.new':'compare.historicalOnly')}</span>}</th>{([['selected',data.selected],['comparison',data.comparison]] as const).map(([key,side])=><td key={key} className="p-3">{row[key] ? <button className="text-left underline decoration-dotted underline-offset-4" onClick={()=>category(side,row.name)} aria-label={`${label(side)} ${row.name} ${t('compare.details')}`}><Amount value={row[key]!.total} currency={currency} compact={false} size="md"/><span className="block text-muted-foreground">{row[key]!.tx_count}{t('home.topCat.countUnit')}</span></button> : '—'}</td>)}<td className="p-3"><Delta selected={row.selected?.total ?? 0} comparison={row.comparison?.total ?? 0} metric={categoryKind} currency={currency}/></td></tr>)}</tbody></table></div>}
        <p className="text-xs text-muted-foreground">{t('compare.coverage')}</p>
      </>}
    </CardContent>}
  </Card>
}

export function Delta({ selected, comparison, metric, currency }: {selected:number;comparison:number;metric:ComparisonMetric;currency:string}) {
  const t=useT();const d=comparisonDelta(selected,comparison,metric)
  return <div className="space-y-1"><div className="font-mono text-sm font-semibold tabular-nums">{d.amount>0?'+':''}<Amount value={d.amount} currency={currency} compact={false} size="md" bold/></div>
    <p className="text-xs leading-relaxed text-muted-foreground">{d.bothZero?t('compare.bothZero'):d.rate===null?t(d.nonPositiveBalance?'compare.balanceBase':'compare.noBase'):`${d.rate>0?'+':''}${(d.rate*100).toFixed(1)}%`}{metric==='expense' && d.amount!==0 ? ` · ${t(d.amount>0?'compare.more':'compare.less')}`:''}</p></div>
}
export function ComparisonSummary({metric,data,currency}:{metric:ComparisonMetric|'count';data:SeasonComparison;currency:string}) {
  const t = useT()
  // 四张卡片的金额与笔数采用同级字号/字重；单位及差额说明单独降级，避免笔数继承正文大字。
  return <div className="min-w-0 rounded-xl border border-border/60 bg-card p-4 shadow-sm">
    <h3 className="mb-4 text-sm font-semibold">{t(metric === 'count' ? 'detail.stats.txCount' : `home.trendBars.${metric}`)}</h3>
    <div className="space-y-3">{[data.selected, data.comparison].map(side => <div key={side.range.year} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${side === data.selected ? 'bg-primary' : 'bg-teal-600'}`} />{seasonLabel(side.range.year, t('ski.suffix'))}</span>
      {metric === 'count'
        ? <span className="font-mono text-lg font-bold tabular-nums">{side.summary.count}<span className="ml-1 text-xs font-normal text-muted-foreground">{t('home.topCat.countUnit')}</span></span>
        : <Amount value={side.summary[metric]} currency={currency} compact={false} size="xl" bold />}
    </div>)}</div>
    <div className="mt-4 border-t border-border/50 pt-3"><span className="mb-1.5 block text-xs text-muted-foreground">{t('compare.difference')}</span>{metric === 'count'
      ? <span className="font-mono text-sm font-semibold tabular-nums">{data.selected.summary.count - data.comparison.summary.count}<span className="ml-1 text-xs font-normal text-muted-foreground">{t('home.topCat.countUnit')}</span></span>
      : <Delta selected={data.selected.summary[metric]} comparison={data.comparison.summary[metric]} metric={metric} currency={currency} />}</div>
  </div>
}
