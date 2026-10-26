import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider } from '@beecount/ui'
import { ApiError, configureHttp } from '@beecount/api-client'
import { dictionaries } from './i18n'
import { loadAppBootstrap } from './lib/appBootstrap'
import { AppBootstrapStatus } from './app/AppBootstrapStatus'

afterEach(() => { vi.unstubAllGlobals(); configureHttp({}) })
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('application bootstrap', () => {
  it('waits for both profile and ledgers before exposing any business data', async () => {
    let resolveLedgers!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/profile/me')
      ? Promise.resolve(ok({ display_name: '合成用户', avatar_url: null }))
      : new Promise<Response>((resolve) => { resolveLedgers = resolve })))
    let ready = false
    const pending = loadAppBootstrap('test-token').then((data) => { ready = true; return data })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ready).toBe(false)
    resolveLedgers(ok([]))
    expect((await pending).ledgers).toEqual([])
    expect(ready).toBe(true)
  })
  it('accepts an actual successful empty ledger list', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(ok(
      url.endsWith('/profile/me') ? { display_name: '合成用户', avatar_url: null } : []))))
    const data = await loadAppBootstrap('test-token')
    expect(data.profile.display_name).toBe('合成用户')
    expect(data.ledgers).toEqual([])
  })
  it.each(['profile/me', 'read/ledgers'])('does not turn a network failure of %s into empty ledgers', async (failed) => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith(failed)
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(ok(url.endsWith('/profile/me') ? { avatar_url: null } : []))))
    await expect(loadAppBootstrap('test-token')).rejects.toThrow('Failed to fetch')
  })
  it('propagates server errors for an explicit error state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('Unavailable', { status: 503 }))))
    await expect(loadAppBootstrap('test-token')).rejects.toMatchObject({ status: 503 })
  })
  it('preserves authentication errors for the existing logout handler', async () => {
    configureHttp({ refreshToken: async () => 'refreshed-test-token' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))))
    await expect(loadAppBootstrap('test-token')).rejects.toBeInstanceOf(ApiError)
    await expect(loadAppBootstrap('test-token')).rejects.toMatchObject({ status: 401 })
  })
  it('keeps the existing logout callback when refresh fails', async () => {
    const logout = vi.fn()
    configureHttp({ refreshToken: async () => { throw new Error('expired') }, onLogout: logout })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))))
    await expect(loadAppBootstrap('test-token')).rejects.toBeDefined()
    expect(logout).toHaveBeenCalled()
  })
})

describe('bootstrap status presentation', () => {
  const render = (status: 'loading' | 'error') => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'zh-CN' }, addEventListener() {}, removeEventListener() {} })
    return renderToStaticMarkup(<LocaleProvider dictionaries={dictionaries}>
      <AppBootstrapStatus status={status} onRetry={() => {}} onLogout={() => {}} />
    </LocaleProvider>)
  }
  it('shows loading instead of a zero-valued business dashboard', () => {
    const html = render('loading')
    expect(html).toContain('role="status"')
    expect(html).toContain('正在加载账本')
    expect(html).not.toContain('总支出')
    expect(html).not.toContain('新建账本')
    expect(html).not.toContain('重试')
  })
  it('shows an actionable failure without claiming there are no ledgers', () => {
    const html = render('error')
    expect(html).toContain('role="alert"')
    expect(html).toContain('重试')
    expect(html).toContain('返回登录')
    expect(html).not.toContain('暂无账本')
    expect(html).not.toContain('0.00')
  })
})
