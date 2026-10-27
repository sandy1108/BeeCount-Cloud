export type TrendSeries = 'expense' | 'income' | 'trend'
export type TrendSeriesVisibility = Record<TrendSeries, boolean>

export const DEFAULT_TREND_VISIBILITY: Readonly<TrendSeriesVisibility> = {
  expense: false,
  income: false,
  trend: true,
}

/** 只切换图层，不修改统计数据；最后一项同时由状态逻辑和按钮禁用保护。 */
export function toggleTrendSeries(visibility: TrendSeriesVisibility, series: TrendSeries): TrendSeriesVisibility {
  if (visibility[series] && Object.values(visibility).filter(Boolean).length === 1) return visibility
  return { ...visibility, [series]: !visibility[series] }
}
