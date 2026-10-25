import { isStandalonePwa } from './pwa-runtime'

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt: () => Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export const PWA_INSTALL_AVAILABLE_EVENT = 'pwa:install-available'
export type PwaInstallState = 'available' | 'installed' | 'manual'
let cachedPrompt: BeforeInstallPromptEvent | null = null
let installedThisSession = false
let initialized = false

/** 只使用可确认的状态；普通标签页无法可靠探测是否已在别处安装。 */
export function getPwaInstallState(): PwaInstallState {
  if (installedThisSession || isStandalonePwa()) return 'installed'
  return cachedPrompt ? 'available' : 'manual'
}

function notifyInstallState(): void {
  window.dispatchEvent(new CustomEvent(PWA_INSTALL_AVAILABLE_EVENT))
}

/** 只缓存安装能力；取消访问计数和自动横幅，由设置页主动触发。 */
export function setupInstallPrompt(): void {
  if (typeof window === 'undefined' || initialized) return
  initialized = true

  window.addEventListener('beforeinstallprompt', (event) => {
    // 阻止浏览器默认安装条，只在用户主动点击设置页按钮时使用此事件。
    event.preventDefault()
    cachedPrompt = event

    notifyInstallState()
  })
  window.addEventListener('appinstalled', () => {
    installedThisSession = true
    cachedPrompt = null
    notifyInstallState()
  })
}

/** 仅在主动点击时调用；先消费一次性事件，防止重复点击。 */
export async function triggerInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!cachedPrompt || getPwaInstallState() === 'installed') return 'unavailable'
  const event = cachedPrompt
  cachedPrompt = null
  notifyInstallState()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') installedThisSession = true
    return choice.outcome
  } catch {
    return 'unavailable'
  } finally {
    notifyInstallState()
  }
}
