import { useMemo } from 'react'
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId } from '@/lib/operations'
import { Progress } from '@/components/ui/progress'
import { useJobStore } from '@/stores/useJobStore'
import { JobRecord } from '@/types/job'

export function QueuePage() {
  const { t } = useI18n()
  const jobs = useJobStore((state) => state.jobs)
  const data = useMemo(() => jobs, [jobs])
  const columns = useMemo<ColumnDef<JobRecord>[]>(() => [
    { header: t('queue.headers.job'), accessorKey: 'name' },
    {
      header: t('queue.headers.operation'),
      accessorKey: 'operation',
      cell: ({ row }) => t(operationKeyFromId(row.original.operation)),
    },
    { header: t('queue.headers.files'), accessorKey: 'totalFiles' },
    {
      header: t('queue.headers.status'),
      accessorKey: 'status',
      cell: ({ row }) => {
        const status = row.original.status
        const tone = status === 'success' ? 'success' : status === 'error' ? 'error' : status === 'running' ? 'running' : 'neutral'
        return <Badge tone={tone}>{t(`status.${status}`)}</Badge>
      },
    },
    {
      header: t('queue.headers.progress'),
      accessorKey: 'progress',
      cell: ({ row }) => <Progress value={row.original.progress} />,
    },
    { header: t('queue.headers.created'), accessorKey: 'createdAt' },
  ], [t])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className='space-y-4'>
      <header>
        <h2 className='text-2xl font-semibold'>{t('queue.title')}</h2>
        <p className='text-sm text-[var(--muted)]'>{t('queue.subtitle')}</p>
      </header>

      <Card className='overflow-hidden p-0'>
        <table className='w-full border-collapse text-sm'>
          <thead className='bg-[var(--surface-2)]'>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className='px-3 py-2 text-left font-medium'>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className='border-t border-[var(--border)]'>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className='px-3 py-2'>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
