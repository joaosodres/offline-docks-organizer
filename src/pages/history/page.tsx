import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'

function formatDateLabel(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export function HistoryPage() {
  const { t } = useI18n()
  const upsertJob = useJobStore((state) => state.upsertJob)
  const jobs = useJobStore((state) => state.jobs)
  const doneJobs = jobs
    .filter((job) => job.status === 'success' || job.status === 'error' || job.status === 'cancelled')
    .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt))

  const rerunJob = async (jobId: string) => {
    const source = jobs.find((job) => job.id === jobId)
    if (!source) return

    const nextJob = await window.toolkit.startJob({
      name: `${source.name} rerun`,
      operation: source.operation,
      paths: source.inputPaths,
      renamePattern: source.renamePattern,
      dryRun: source.dryRun,
    })
    upsertJob(nextJob)
  }

  return (
    <div className='h-full overflow-y-auto bg-[#09090b] px-6 py-8'>
      <div className='mx-auto max-w-6xl space-y-6'>
        <header className='space-y-2'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('nav.history')}</p>
          <h2 className='text-3xl font-semibold tracking-tight text-zinc-100'>{t('history.title')}</h2>
          <p className='max-w-2xl text-sm text-zinc-500'>{t('history.subtitle')}</p>
        </header>

        {doneJobs.length === 0 ? (
          <Card className='border border-[#27272a] bg-[#101014] p-8'>
            <p className='text-sm text-zinc-400'>{t('history.empty')}</p>
          </Card>
        ) : (
          <div className='grid gap-4'>
            {doneJobs.map((job) => {
              const tone = job.status === 'success' ? 'success' : job.status === 'error' ? 'error' : 'neutral'
              const outputPath = job.outputPath

              return (
                <Card key={job.id} className='border border-[#27272a] bg-[#101014] p-0 overflow-hidden'>
                  <div className='flex flex-wrap items-start justify-between gap-4 border-b border-[#27272a] px-6 py-5'>
                    <div className='min-w-0 space-y-2'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <p className='text-lg font-semibold text-zinc-100'>{job.name}</p>
                        {job.dryRun && (
                          <span className='rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300'>
                            {t('history.dryRun')}
                          </span>
                        )}
                      </div>
                      <p className='text-sm text-zinc-400'>{t(operationKeyFromId(job.operation))}</p>
                    </div>
                    <Badge tone={tone}>{t(`status.${job.status}`)}</Badge>
                  </div>

                  <div className='grid gap-4 px-6 py-5 lg:grid-cols-[220px_minmax(0,1fr)]'>
                    <div className='grid gap-3 text-xs'>
                      <div className='rounded-xl border border-[#27272a] bg-[#0b0b0e] px-3 py-2.5'>
                        <p className='mb-1 uppercase tracking-wider text-zinc-500'>{t('history.created')}</p>
                        <p className='text-zinc-300'>{formatDateLabel(job.createdAt) ?? '-'}</p>
                      </div>
                      <div className='rounded-xl border border-[#27272a] bg-[#0b0b0e] px-3 py-2.5'>
                        <p className='mb-1 uppercase tracking-wider text-zinc-500'>{t('history.finished')}</p>
                        <p className='text-zinc-300'>{formatDateLabel(job.completedAt) ?? '-'}</p>
                      </div>
                      <div className='rounded-xl border border-[#27272a] bg-[#0b0b0e] px-3 py-2.5'>
                        <p className='mb-1 uppercase tracking-wider text-zinc-500'>{t('history.inputs')}</p>
                        <p className='text-zinc-300'>{t('history.inputsCount').replace('{count}', String(job.inputPaths.length))}</p>
                      </div>
                    </div>

                    <div className='space-y-4'>
                      <div className='rounded-xl border border-[#27272a] bg-[#0b0b0e] px-4 py-3'>
                        <p className='mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('history.output')}</p>
                        <p className='break-all text-sm text-zinc-300'>
                          {job.outputPath || t('history.noOutput')}
                        </p>
                      </div>

                      {job.error?.message && (
                        <div className='rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3'>
                          <p className='mb-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-300'>{t('history.error')}</p>
                          <p className='text-sm text-rose-200'>{job.error.message}</p>
                        </div>
                      )}

                      <div className='flex flex-wrap gap-2'>
                        <Button variant='secondary' onClick={() => void rerunJob(job.id)}>
                          {t('history.rerun')}
                        </Button>
                        {outputPath && (
                          <Button variant='ghost' onClick={() => void window.toolkit.revealInFolder(outputPath)}>
                            {t('history.showOutput')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
