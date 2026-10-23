import { FileSpreadsheet, Image, ShieldCheck } from 'lucide-react'
import { Card, CardContent, useT } from '@beecount/ui'
import type { ImportSummary } from '@beecount/api-client'

/** 百事AA的范围及来源信息独立展示，不侵入通用字段映射组件。 */
export function BaishiImportCard({ summary }: { summary?: ImportSummary | null }) {
  const t = useT()
  if (summary && summary.source_format !== 'baishi_aa') return null
  return (
    <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/10 via-background to-background">
      <CardContent className="flex gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <FileSpreadsheet className="h-6 w-6" />
        </div>
        <div className="min-w-0 space-y-2">
          <h2 className="font-semibold">{t('import.baishi.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('import.baishi.description')}</p>
          {summary ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t('import.baishi.source', { name: summary.source_ledger_name || '—' })}</span>
              <span className="inline-flex items-center gap-1"><Image className="h-3.5 w-3.5" />{t('import.baishi.images', { count: summary.attachment_count })}</span>
            </div>
          ) : null}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('import.baishi.scope')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
