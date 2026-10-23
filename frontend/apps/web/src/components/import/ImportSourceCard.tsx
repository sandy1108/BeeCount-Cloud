import { ArchiveRestore, FileSpreadsheet, Image, ShieldCheck } from 'lucide-react'
import { Card, CardContent, useT } from '@beecount/ui'
import type { ImportSummary } from '@beecount/api-client'

export type ImportEntry = 'standard' | 'baishi'

/** 两种导入入口共用视觉结构，来源说明与预览结果保持一致。 */
export function ImportSourceCard({ entry, summary }: { entry: ImportEntry; summary?: ImportSummary | null }) {
  const t = useT()
  const baishi = entry === 'baishi'
  const Icon = baishi ? FileSpreadsheet : ArchiveRestore
  const formats = baishi ? ['百事AA Excel', t('import.entry.categories'), t('import.entry.images')] : ['BeeCount', 'CSV / TSV', 'Excel']
  return (
    <Card className="overflow-hidden rounded-xl border-primary/25 bg-gradient-to-br from-primary/10 via-background to-background">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:gap-5 sm:p-6">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/10">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold sm:text-lg">{t(baishi ? 'import.baishi.title' : 'import.entry.standard')}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{t(baishi ? 'import.baishi.description' : 'import.entry.standardDescription')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {formats.map((label) => <span key={label} className="rounded-full border border-primary/15 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-primary">{label}</span>)}
          </div>
          {baishi && summary ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t('import.baishi.source', { name: `${summary.source_ledger_name || '—'} · ${summary.source_currency || '—'}` })}</span>
              <span className="inline-flex items-center gap-1"><Image className="h-3.5 w-3.5" />{t('import.baishi.images', { count: summary.attachment_count })}</span>
            </div>
          ) : null}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t(baishi ? 'import.baishi.scope' : 'import.entry.standardScope')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
