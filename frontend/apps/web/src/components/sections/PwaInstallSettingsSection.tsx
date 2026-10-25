import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle, useT, useToast } from '@beecount/ui'
import { getPwaInstallState, PWA_INSTALL_AVAILABLE_EVENT, triggerInstallPrompt } from '../../lib/pwa-install'

/** 安装能力变化只更新设置页按钮，不再打断记账。 */
export function PwaInstallSettingsSection() {
  const t = useT()
  const toast = useToast()
  const [state, setState] = useState(getPwaInstallState)
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    const update = () => setState(getPwaInstallState())
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, update)
    update()
    return () => window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, update)
  }, [])

  return (
    <Card className="bc-panel">
      <CardHeader>
        <CardTitle className="text-base">{t('pwa.install.settingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {t(state === 'installed' ? 'pwa.install.installedHint' : 'pwa.install.manualHint')}
        </p>
        <Button variant="outline" className="shrink-0" disabled={state !== 'available' || installing}
          onClick={async () => {
            setInstalling(true)
            const result = await triggerInstallPrompt()
            setInstalling(false)
            setState(getPwaInstallState())
            if (result === 'accepted') toast.success(t('pwa.install.accepted'))
          }}>
          <Download className="mr-2 h-4 w-4" />
          {t(state === 'installed' ? 'pwa.install.installed' : state === 'manual' ? 'pwa.install.browserMenu' : 'pwa.install.settingsTitle')}
        </Button>
      </CardContent>
    </Card>
  )
}
