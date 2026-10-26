import { CloudOff, LoaderCircle } from 'lucide-react'
import { Button, useT } from '@beecount/ui'

/** 初始化期间不挂载业务面板，错误信息也不直接暴露服务响应或凭据。 */
export function AppBootstrapStatus({ status, onRetry, onLogout }: {
  status: 'loading' | 'error'
  onRetry: () => void
  onLogout: () => void
}) {
  const t = useT()
  const loading = status === 'loading'
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm"
        role={loading ? 'status' : 'alert'} aria-live="polite" aria-busy={loading}>
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {loading ? <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
            : <CloudOff className="h-7 w-7" aria-hidden="true" />}
        </div>
        <h1 className="text-xl font-semibold">{t(loading ? 'app.bootstrap.loading' : 'app.bootstrap.error')}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t(loading ? 'app.bootstrap.loadingHint' : 'app.bootstrap.errorHint')}
        </p>
        {!loading && <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={onRetry}>{t('app.bootstrap.retry')}</Button>
          <Button variant="outline" onClick={onLogout}>{t('app.bootstrap.login')}</Button>
        </div>}
      </section>
    </main>
  )
}
