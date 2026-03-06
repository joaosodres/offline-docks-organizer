import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'

export function QueuePage() {
  const { t } = useI18n()
  const jobs = useJobStore((state) => state.jobs)
  const queueJobs = jobs.filter((job) => job.status === 'running' || job.status === 'idle').sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className='h-full overflow-y-auto p-6'>
      <div className='space-y-4'>
        <header>
          <h2 className='text-2xl font-semibold'>{t('queue.title')}</h2>
          <p className='text-sm text-[var(--muted)]'>{t('queue.subtitle')}</p>
        </header>

      <div className='grid gap-3'>
        {queueJobs.length === 0 && <Card>{t('queue.empty')}</Card>}
        {queueJobs.map((job) => {
          const tone = job.status === 'success'
            ? 'success'
            : job.status === 'error'
              ? 'error'
              : job.status === 'cancelled'
                ? 'neutral'
                : 'running'

          return (
            <Card key={job.id} className='space-y-4'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='space-y-1'>
                  <p className='font-medium'>{job.name}</p>
                  <p className='text-sm text-[var(--muted)]'>{t(operationKeyFromId(job.operation))}</p>
                  <p className='text-xs text-[var(--muted)]'>{job.createdAt}</p>
                </div>
                <Badge tone={tone}>{t(`status.${job.status}`)}</Badge>
              </div>

              <div className='space-y-2'>
                <div className='flex items-center justify-between text-xs text-[var(--muted)]'>
                  <span>{t('queue.filesCount').replace('{count}', String(job.totalFiles))}</span>
                  <span>{job.progress}%</span>
                </div>
                <Progress value={job.progress} />
              </div>

              <div className='flex flex-wrap gap-2'>
                <Button variant='secondary' onClick={() => void window.toolkit.cancelJob(job.id)}>
                  {t('queue.cancel')}
                </Button>
                {job.outputPath && (
                  <Button variant='ghost' onClick={() => void window.toolkit.revealInFolder(job.outputPath!)}>
                    {t('queue.showOutput')}
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
    </div>
  )
}
