/** 雪季按起始年标识；五月起进入下一雪季年度。 */
export type DashboardScope = 'month' | 'year' | 'all'
export function currentSkiSeason(now = new Date()): number {
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}
export function seasonLabel(year: number, suffix = '雪季'): string {
  return `${String(year).slice(-2)}~${String(year + 1).slice(-2)}${suffix}`
}
export function seasonMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(year, 4 + i, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

/** 补齐雪季12个月的零值桶，避免折线跨过无交易月份且误报只有4个月。 */
export function fillSeasonSeries<T extends { bucket: string; income: number; expense: number; balance: number }>(year: number, series: T[]) {
  const byBucket = new Map(series.map((item) => [item.bucket, item]))
  return seasonMonths(year).map((bucket) => byBucket.get(bucket) ?? { bucket, income: 0, expense: 0, balance: 0 })
}

/** 月/日桶的起始时间尚未到来；未来已记数据仍保留，只增加提示。 */
export function isFutureBucket(bucket: string, now = new Date()): boolean {
  const date = new Date(`${bucket.length === 7 ? `${bucket}-01` : bucket}T00:00:00`)
  return date.getTime() > now.getTime()
}
