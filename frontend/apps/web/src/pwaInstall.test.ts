import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('manual PWA installation', () => {
  let target: EventTarget
  beforeEach(() => {
    vi.resetModules()
    target = new EventTarget()
    vi.stubGlobal('window', Object.assign(target, {
      matchMedia: () => ({ matches: false }), navigator: {},
    }))
    vi.stubGlobal('document', { referrer: '' })
  })
  afterEach(() => vi.unstubAllGlobals())
  function offer(outcome: 'accepted' | 'dismissed' = 'accepted', prompt = vi.fn(async () => {})) {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome, platform: 'web' }) })
    target.dispatchEvent(event)
    return { event, prompt }
  }
  it('captures capability silently without accessing visits or old dismissal preferences', async () => {
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    api.setupInstallPrompt()
    expect(api.getPwaInstallState()).toBe('manual')
    const { event, prompt } = offer()
    expect(event.defaultPrevented).toBe(true)
    expect(api.getPwaInstallState()).toBe('available')
    expect(prompt).not.toHaveBeenCalled()
  })
  it('only prompts on an explicit action and consumes the event once', async () => {
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    const { prompt } = offer()
    const first = api.triggerInstallPrompt()
    expect(await api.triggerInstallPrompt()).toBe('unavailable')
    expect(await first).toBe('accepted')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(api.getPwaInstallState()).toBe('installed')
  })
  it('keeps a manual fallback after cancellation and accepts a fresh browser offer', async () => {
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    offer('dismissed')
    expect(await api.triggerInstallPrompt()).toBe('dismissed')
    expect(api.getPwaInstallState()).toBe('manual')
    offer()
    expect(api.getPwaInstallState()).toBe('available')
  })
  it('provides a safe fallback when installation is unsupported or fails', async () => {
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    expect(await api.triggerInstallPrompt()).toBe('unavailable')
    offer('accepted', vi.fn(async () => { throw new Error('not supported') }))
    expect(await api.triggerInstallPrompt()).toBe('unavailable')
    expect(api.getPwaInstallState()).toBe('manual')
  })
  it('updates settings when installation completes from the browser menu', async () => {
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    offer()
    target.dispatchEvent(new Event('appinstalled'))
    expect(api.getPwaInstallState()).toBe('installed')
    expect(await api.triggerInstallPrompt()).toBe('unavailable')
  })
  it('does not offer to reinstall inside a standalone app', async () => {
    vi.stubGlobal('window', Object.assign(target, {
      matchMedia: () => ({ matches: true }), navigator: {},
    }))
    const api = await import('./lib/pwa-install')
    api.setupInstallPrompt()
    const { prompt } = offer()
    expect(api.getPwaInstallState()).toBe('installed')
    expect(await api.triggerInstallPrompt()).toBe('unavailable')
    expect(prompt).not.toHaveBeenCalled()
  })
})
