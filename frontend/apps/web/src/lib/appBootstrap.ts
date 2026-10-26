import { fetchProfileMe, fetchReadLedgers } from '@beecount/api-client'

/** 资料和账本必须一起成功，避免将未读取的数据误显示为零或空账本。 */
export async function loadAppBootstrap(token: string) {
  const [profile, ledgers] = await Promise.all([
    fetchProfileMe(token),
    fetchReadLedgers(token),
  ])
  return { profile, ledgers }
}
