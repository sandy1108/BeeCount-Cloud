import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { dictionaries } from './i18n'
import { Delta, ComparisonSummary } from './components/dashboard/SeasonComparisonPanel'
import { fetchSeasonComparison, type SeasonComparison } from '@beecount/api-client'
beforeEach(()=>vi.stubGlobal('window',{localStorage:{getItem:()=> 'zh-CN'},addEventListener(){},removeEventListener(){}}))
afterEach(()=>vi.unstubAllGlobals())
const render=(node:React.ReactNode)=>renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>{node}</LocaleProvider>)
it('explains more/less spending, no baseline and negative balances without infinity',()=>{
 expect(render(<Delta selected={30} comparison={20} metric="expense" currency="CNY"/>)).toContain('多支出')
 expect(render(<Delta selected={10} comparison={20} metric="expense" currency="CNY"/>)).toContain('少支出')
 expect(render(<Delta selected={10} comparison={0} metric="income" currency="CNY"/>)).toContain('对比季无基数')
 expect(render(<Delta selected={0} comparison={0} metric="expense" currency="CNY"/>)).toContain('两边均无已记金额')
 const negative=render(<Delta selected={-10} comparison={-20} metric="balance" currency="CNY"/>)
 expect(negative).toContain('结余基数非正');expect(negative).not.toContain('%')
})
it('keeps income, expense and balance as separate original cashflow totals',()=>{
 const summary={income:120,expense:300,balance:-180,count:1005}
 const a={range:{year:2026},summary} as SeasonComparison['selected']
 const b={range:{year:2025},summary:{...summary,income:100}} as SeasonComparison['selected']
 for (const metric of ['income','expense','balance','count'] as const){
  const html=render(<ComparisonSummary metric={metric} data={{selected:a,comparison:b}} currency="CNY"/>)
  expect(html).toContain('26~27雪季');expect(html).toContain('25~26雪季')
  expect(html).toContain(metric==='count'?'1005':String(Math.abs(summary[metric])))
 }
})
it('sends the selected years, cutoff and frozen timezone without user identity filters',async()=>{
 let url:URL|undefined
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{url=new URL(input,'http://test');return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})}))
 await fetchSeasonComparison('synthetic',{ledgerId:'ski',season:2026,compareSeason:2025,mode:'same',cutoff:'2026-10-26',tzOffsetMinutes:480})
 expect(Object.fromEntries(url!.searchParams)).toEqual({ledger_id:'ski',season:'2026',compare_season:'2025',mode:'same',cutoff:'2026-10-26',tz_offset_minutes:'480'})
})
