import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLedgers } from '../context/LedgersContext'
import { parseStatisticsContext } from './statisticsContext'

/** 首次深链选择可见账本；用户随后主动换账本时退出旧统计条件。 */
export function useStatisticsContext() {
  const [params, setParams] = useSearchParams()
  const { activeLedgerId, ledgers, setActiveLedgerId } = useLedgers()
  const raw = params.get('stats') || ''
  const ledger = params.get('ledger') || ''
  const context = useMemo(() => parseStatisticsContext(new URLSearchParams({ stats: raw, ledger })), [raw, ledger])
  const selected = useRef('')
  const clear = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('stats'); next.delete('ledger')
    setParams(next, { replace: true })
  }, [params, setParams])
  useEffect(() => {
    if (!context) { selected.current = ''; return }
    if (selected.current !== raw) {
      if (!ledgers.some(item => item.ledger_id === context.ledgerId)) return
      selected.current = raw
      setActiveLedgerId(context.ledgerId)
    } else if (activeLedgerId && activeLedgerId !== context.ledgerId) clear()
  }, [context, raw, ledgers, activeLedgerId, setActiveLedgerId, clear])
  return { context, clear, raw }
}
