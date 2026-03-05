import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'

export function HistoryPage() {
  const { t } = useI18n()
  const jobs = useJobStore((state) => state.jobs)
  const doneJobs = jobs.filter((job) => job.status === 'success' || job.status === 'error')

  return (
    <div className='space-y-4'>
      <header>
        <h2 className='text-2xl font-semibold'>{t('history.title')}</h2>
        <p className='text-sm text-[var(--muted)]'>{t('history.subtitle')}</p>
      </header>

      <div className='grid gap-3'>
        {doneJobs.length === 0 && <Card>{t('history.empty')}</Card>}
        {doneJobs.map((job) => (
          <Card key={job.id} className='space-y-1'>
            <p className='font-medium'>{job.name}</p>
            <p className='text-sm text-[var(--muted)]'>{t(operationKeyFromId(job.operation))}</p>
            <p className='text-xs text-[var(--muted)]'>{job.createdAt}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
