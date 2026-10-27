import { describe, expect, it } from 'vitest'
import { comparisonDelta, comparisonBarMonth, comparisonCategories, comparisonMonths, comparisonContext, defaultComparisonMode, defaultComparisonCutoff, localDateAtOffset, patchComparisonSettings } from './lib/seasonComparison'
import { parseStatisticsContext, statisticsLink } from './lib/statisticsContext'
import { monthContext } from './lib/monthStatistics'
import type { SeasonComparisonSide } from '@beecount/api-client'
const side = (year: number): SeasonComparisonSide => ({
  range: { year, start_at: `${year}-04-30T16:00:00Z`, end_at_exclusive: `${year}-06-15T16:00:00Z`,
    start_date: `${year}-05-01`, end_date:`${year}-06-15`, empty_period:false, leap_adjusted:false,not_ended:true,includes_today:false },
  summary:{expense:30,income:1,balance:-29,count:3}, expenseCategories:[],incomeCategories:[],
  monthly:[{bucket:`${year}-05`,expense:10,income:1,balance:-9,count:1,partial:false},
    {bucket:`${year}-06`,expense:20,income:0,balance:-20,count:2,partial:true}],
})
describe('season comparison boundaries and presentation',()=>{
 it('defaults ongoing to yesterday and ended to full, including May first and timezone',()=>{
  expect(defaultComparisonMode(2026,'2026-10-27')).toBe('same')
  expect(defaultComparisonMode(2025,'2026-05-01')).toBe('full')
  expect(defaultComparisonCutoff(2026,'2026-05-01')).toBe('')
  expect(defaultComparisonCutoff(2025,'2026-05-01')).toBe('2026-04-30')
  expect(defaultComparisonCutoff(2026,'2026-10-27')).toBe('2026-10-26')
  expect(localDateAtOffset(new Date('2026-04-30T16:00:00Z'),480)).toBe('2026-05-01')
 })
 it('never divides by zero or a nonpositive balance',()=>{
  expect(comparisonDelta(10,0,'expense')).toEqual({amount:10,rate:null,bothZero:false,nonPositiveBalance:false})
  expect(comparisonDelta(0,0,'income').bothZero).toBe(true)
  expect(comparisonDelta(-5,-10,'balance').rate).toBeNull()
  expect(comparisonDelta(10,20,'expense').rate).toBe(-.5)
 })
 it('takes the category union, preserving names, zeros and historical-only entries',()=>{
  const cat=(name:string,total:number)=>({category_name:name,total,tx_count:1})
  const rows=comparisonCategories([cat('住宿',20),cat('新增',0)],[cat('住宿',30),cat('旧分类',8)])
  expect(new Set(rows.map(r=>r.name))).toEqual(new Set(['住宿','新增','旧分类']))
  expect(rows.find(r=>r.name==='旧分类')?.selected).toBeUndefined()
 })
 it('aligns May to April and stops cumulative values at each exact cutoff',()=>{
  const rows=comparisonMonths(side(2026),side(2025),'expense',true)
  expect(rows[1]).toMatchObject({selected:30,comparison:30,partial:true,bucket:'2026-06',other:'2025-06'})
  expect(rows[2].selected).toBeNull();expect(rows[11].bucket).toBe('2027-04')
 })
 it('keeps each side and partial month in category, month and URL drilldown',()=>{
  const context=comparisonContext(side(2025),{ledgerId:'ski',ledgerName:'合成',currency:'MOP'},480,{name:'住宿',kind:'income'})
  expect(context.txType).toBe('income');expect(context.categoryGroup).toBe('住宿')
  expect(monthContext(context,'2025-06')?.dateTo).toBe('2025-06-15T16:00:00.000Z')
  expect(context.currency).toBe('MOP')
  expect(parseStatisticsContext(new URLSearchParams(statisticsLink(context).split('?')[1]))).toEqual(context)
 })
})

it('merges rapid control changes without overwriting the prior URL and resets another season defaults',()=>{
 const defaults={compareMode:'full',compareCutoff:'2026-10-26',compareYear:'2025',compareOffset:'480'}
 const first=patchComparisonSettings(new URLSearchParams({scope:'year',season:'2026'}),'ski:2026',defaults,{compare:'1'})
 const second=patchComparisonSettings(first,'ski:2026',defaults,{compareMode:'same'})
 const third=patchComparisonSettings(second,'ski:2026',defaults,{compareCategory:'income'})
 expect(third.get('compareMode')).toBe('same')
 expect(third.get('compareCategory')).toBe('income')
 const changed=patchComparisonSettings(third,'other:2025',{...defaults,compareYear:'2024'},{compare:'1'})
 expect(changed.get('compareCategory')).toBeNull()
 expect(changed.get('compareMode')).toBe('full')
 expect(changed.get('compareYear')).toBe('2024')
 expect(changed.get('scope')).toBe('year')
})

it('uses the clicked payload rather than the filtered bar index after zero months',()=>{
 const event={payload:{bucket:'2026-10',other:'2025-10',selected:1740,comparison:1660}}
 expect(comparisonBarMonth(event,'selected')).toBe('2026-10')
 expect(comparisonBarMonth(event,'comparison')).toBe('2025-10')
 expect(comparisonBarMonth({payload:{...event.payload,selected:null}},'selected')).toBeNull()
 expect(comparisonBarMonth({},'selected')).toBeNull()
})
