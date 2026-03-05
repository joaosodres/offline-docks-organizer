import { DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId, operationOptions, type OperationId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'
import { useSelectionStore } from '@/stores/useSelectionStore'
import { useUiStore } from '@/stores/useUiStore'

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif'])
const pdfExtensions = new Set(['pdf'])
GlobalWorkerOptions.workerSrc = pdfWorker

function getFileName(fullPath: string) {
  const normalized = fullPath.replaceAll('\\', '/')
  return normalized.split('/').pop() || fullPath
}

function getFileExtension(fullPath: string) {
  const fileName = getFileName(fullPath)
  const index = fileName.lastIndexOf('.')
  if (index <= 0) return ''
  return fileName.slice(index + 1).toLowerCase()
}

function isImagePath(fullPath: string) {
  return imageExtensions.has(getFileExtension(fullPath))
}

function isPdfPath(fullPath: string) {
  return pdfExtensions.has(getFileExtension(fullPath))
}

function toFileUrl(fullPath: string) {
  return encodeURI(`file://${fullPath}`)
}

async function getPdfPreview(targetPath: string) {
  try {
    const loadingTask = getDocument(toFileUrl(targetPath))
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const scale = viewport.width > 0 ? 256 / viewport.width : 1
    const scaledViewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null
    canvas.width = Math.ceil(scaledViewport.width)
    canvas.height = Math.ceil(scaledViewport.height)
    await page.render({ canvas, canvasContext: context, viewport: scaledViewport }).promise
    const preview = canvas.toDataURL('image/png')
    await pdf.destroy()
    return preview
  } catch {
    return null
  }
}

function reorderPaths(paths: string[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return paths
  const next = [...paths]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function normalizeDroppedPath(rawPath: string) {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('file://')) {
    try {
      return decodeURIComponent(trimmed.replace('file://', ''))
    } catch {
      return ''
    }
  }
  return trimmed
}

export function DashboardPage() {
  const [operation, setOperation] = useState<OperationId>('merge_pdf_rename')
  const [renamePattern, setRenamePattern] = useState('{name}_{seq}')
  const [isPicking, setIsPicking] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [previewByPath, setPreviewByPath] = useState<Record<string, string>>({})
  const previewByPathRef = useRef<Record<string, string>>({})
  const selectedPathsRef = useRef<string[]>([])
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const selectedPaths = useSelectionStore((state) => state.selectedPaths)
  const setSelectedPaths = useSelectionStore((state) => state.setSelectedPaths)
  const upsertJob = useJobStore((state) => state.upsertJob)
  const jobs = useJobStore((state) => state.jobs)
  const lastOutputPath = useUiStore((state) => state.lastOutputPath)
  const lastError = useUiStore((state) => state.lastError)
  const setLastError = useUiStore((state) => state.setLastError)
  const { t, language } = useI18n()

  const canStart = useMemo(() => selectedPaths.length > 0 && !isStarting, [isStarting, selectedPaths.length])
  const toolkit = window.toolkit

  useEffect(() => {
    previewByPathRef.current = previewByPath
  }, [previewByPath])

  useEffect(() => {
    selectedPathsRef.current = selectedPaths
  }, [selectedPaths])

  useEffect(() => {
    if (!toolkit?.getImagePreview) return

    let isDisposed = false
    const previewablePaths = selectedPaths.filter((filePath) => isImagePath(filePath) || isPdfPath(filePath))

    // Preserve previews already loaded for current list to avoid flicker on reorder.
    setPreviewByPath((previous) => {
      const next: Record<string, string> = {}
      for (const filePath of previewablePaths) {
        if (previous[filePath]) next[filePath] = previous[filePath]
      }
      return next
    })

    const loadMissingPreviews = async () => {
      const loaded: Record<string, string> = {}
      for (const filePath of previewablePaths) {
        const alreadyLoaded = previewByPathRef.current[filePath]
        if (alreadyLoaded) continue
        const preview = isImagePath(filePath)
          ? await toolkit.getImagePreview(filePath)
          : await getPdfPreview(filePath)
        if (preview) loaded[filePath] = preview
      }

      if (!isDisposed && Object.keys(loaded).length > 0) {
        setPreviewByPath((previous) => ({ ...previous, ...loaded }))
      }
    }

    loadMissingPreviews()
    return () => {
      isDisposed = true
    }
  }, [selectedPaths, toolkit])

  useEffect(() => {
    if (!toolkit?.onJobResult) return

    const unsubscribe = toolkit.onJobResult((payload) => {
      if (selectedPathsRef.current.length === 0) return
      if (payload.paths && payload.paths.length > 0) {
        setSelectedPaths(payload.paths)
        return
      }
      setSelectedPaths([])
    })

    return () => unsubscribe()
  }, [setSelectedPaths, toolkit, t])

  const pickPaths = async () => {
    setIsPicking(true)
    try {
      const paths = await toolkit?.pickPaths?.()
      if (!paths) return
      setSelectedPaths(paths)
    } finally {
      setIsPicking(false)
    }
  }

  const startJob = async () => {
    if (!selectedPaths.length) return

    setIsStarting(true)
    setLastError(null)
    try {
      const job = await toolkit?.startJob?.({
        name: `Batch ${new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`,
        operation,
        paths: selectedPaths,
        renamePattern,
      })
      if (!job) return
      upsertJob(job)
    } finally {
      setIsStarting(false)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(true)
  }

  const handleDragLeave = () => {
    setIsDragActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragActive(false)

    const droppedFromFiles = Array.from(event.dataTransfer.files).map((file) => {
      return normalizeDroppedPath(
        toolkit?.getPathForFile?.(file) || (file as File & { path?: string }).path || '',
      )
    })

    const droppedFromItems = Array.from(event.dataTransfer.items)
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file) => normalizeDroppedPath(toolkit?.getPathForFile?.(file) || ''))

    const rawUriList = event.dataTransfer.getData('text/uri-list')
    const droppedFromUris = rawUriList
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(normalizeDroppedPath)

    const rawText = event.dataTransfer.getData('text/plain')
    const droppedFromPlainText = rawText
      .split('\n')
      .map((line) => normalizeDroppedPath(line))
      .filter((line) => line.startsWith('/'))

    const droppedPaths = [...new Set([
      ...droppedFromFiles,
      ...droppedFromItems,
      ...droppedFromUris,
      ...droppedFromPlainText,
    ])].filter(Boolean)

    if (droppedPaths.length > 0) {
      setSelectedPaths(droppedPaths)
    }
  }

  const handleItemDrop = (targetPath: string) => {
    if (!draggedPath || draggedPath === targetPath) return
    const fromIndex = selectedPaths.indexOf(draggedPath)
    const toIndex = selectedPaths.indexOf(targetPath)
    if (fromIndex < 0 || toIndex < 0) return
    setSelectedPaths(reorderPaths(selectedPaths, fromIndex, toIndex))
    setDraggedPath(null)
    setDragOverPath(null)
  }

  const removeItem = (targetPath: string) => {
    setSelectedPaths(selectedPaths.filter((path) => path !== targetPath))
  }

  const expandedPreviewSrc = expandedPreviewPath ? previewByPath[expandedPreviewPath] : null
  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'idle').slice(0, 5),
    [jobs],
  )

  return (
    <div className='space-y-4'>
      <header>
        <h2 className='text-2xl font-semibold'>{t('dashboard.title')}</h2>
        <p className='text-sm text-[var(--muted)]'>{t('dashboard.subtitle')}</p>
      </header>

      <Card className='space-y-4'>
        <div className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm'>
          <p className='font-medium'>{t('dashboard.liveProgress')}</p>
          <div className='mt-2 space-y-2'>
            {activeJobs.length === 0 && <p className='text-[var(--muted)]'>{t('dashboard.noActiveJobs')}</p>}
            {activeJobs.map((job) => (
              <div key={job.id} className='rounded-md border border-[var(--border)] bg-white p-2'>
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <p className='truncate text-sm font-medium'>{job.name}</p>
                  <p className='text-xs text-[var(--muted)]'>{t(`status.${job.status}`)}</p>
                </div>
                <p className='mb-1 truncate text-xs text-[var(--muted)]'>{t(operationKeyFromId(job.operation))}</p>
                <Progress value={job.progress} />
              </div>
            ))}
          </div>
        </div>

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'rounded-lg border border-dashed p-10 text-center transition-colors',
            isDragActive
              ? 'border-[var(--primary)] bg-cyan-50'
              : 'border-[var(--border)]',
          ].join(' ')}
        >
          <p className='font-medium'>{t('dashboard.dropTitle')}</p>
          <p className='text-sm text-[var(--muted)]'>{t('dashboard.dropSubtitle')}</p>
          <div className='mt-3 flex items-center justify-center gap-2'>
            <Button variant='secondary' onClick={pickPaths} disabled={isPicking}>
              {isPicking ? t('dashboard.selecting') : t('dashboard.selectButton')}
            </Button>
            <Button onClick={startJob} disabled={!canStart}>
              {isStarting ? t('dashboard.starting') : t('dashboard.startButton')}
            </Button>
          </div>
        </div>

        <div className='grid gap-1 text-sm'>
          <label htmlFor='operation' className='font-medium'>
            {t('common.operation')}
          </label>
          <select
            id='operation'
            value={operation}
            onChange={(event) => setOperation(event.target.value as OperationId)}
            className='w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm'
          >
            {operationOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {t(option.translationKey)}
              </option>
            ))}
          </select>
        </div>

        {(operation === 'batch_rename' || operation === 'merge_pdf_rename' || operation === 'images_to_pdf') && (
          <div className='grid gap-1 text-sm'>
            <label htmlFor='renamePattern' className='font-medium'>
              {operation === 'batch_rename' ? t('dashboard.renamePattern') : t('dashboard.outputPattern')}
            </label>
            <input
              id='renamePattern'
              value={renamePattern}
              onChange={(event) => setRenamePattern(event.target.value)}
              className='w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm'
              placeholder='{name}_{seq}'
            />
            <p className='text-xs text-[var(--muted)]'>{t('dashboard.tokens')} {'{name}'} {'{seq}'} {'{date}'}</p>
            {operation === 'batch_rename' && (
              <>
                <p className='text-xs text-[var(--muted)]'>{t('dashboard.renameDestination')}</p>
                <p className='text-xs text-[var(--muted)]'>{t('dashboard.renameOrderHint')}</p>
              </>
            )}
            {operation === 'merge_pdf_rename' && (
              <p className='text-xs text-[var(--muted)]'>{t('dashboard.mergeDestination')}</p>
            )}
            {operation === 'images_to_pdf' && (
              <p className='text-xs text-[var(--muted)]'>{t('dashboard.imagesPdfDestination')}</p>
            )}
          </div>
        )}

        {lastOutputPath && (
          <div className='rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm'>
            <p className='font-medium'>{t('dashboard.lastOutput')}</p>
            <p className='mt-1 break-all text-[var(--muted)]'>{lastOutputPath}</p>
            <div className='mt-2'>
              <Button variant='secondary' onClick={() => toolkit?.revealInFolder?.(lastOutputPath)}>
                {t('dashboard.openInFinder')}
              </Button>
            </div>
          </div>
        )}

        {lastError && (
          <div className='rounded-md border border-rose-300 bg-rose-50 p-3 text-sm'>
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <p className='font-medium text-rose-900'>{t('dashboard.processingError')} {t(operationKeyFromId(lastError.operation))}</p>
                <p className='mt-1 text-rose-800'>{lastError.message}</p>
                <p className='mt-1 text-xs text-rose-700'>{new Date(lastError.at).toLocaleString()}</p>
              </div>
              <Button variant='secondary' onClick={() => setLastError(null)}>
                {t('common.close')}
              </Button>
            </div>
            <pre className='mt-2 max-h-40 overflow-auto rounded bg-white p-2 text-xs text-rose-900'>{lastError.detail}</pre>
          </div>
        )}

        <div className='space-y-2'>
          <h3 className='font-medium'>{t('dashboard.selectedFiles')} ({selectedPaths.length})</h3>
          <ul className='grid max-h-[52vh] grid-cols-1 gap-3 overflow-auto pr-1 text-sm text-[var(--muted)] md:grid-cols-2 xl:grid-cols-3'>
            {selectedPaths.length === 0 && <li>{t('dashboard.noSelectedFiles')}</li>}
            {selectedPaths.map((path) => (
              <li
                key={path}
                draggable
                onDragStart={() => setDraggedPath(path)}
                onDragEnd={() => {
                  setDraggedPath(null)
                  setDragOverPath(null)
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragEnter={() => setDragOverPath(path)}
                onDrop={() => handleItemDrop(path)}
                className={[
                  'relative rounded border bg-[var(--surface-2)] p-2',
                  dragOverPath === path ? 'border-[var(--primary)]' : 'border-[var(--border)]',
                ].join(' ')}
              >
                <button
                  type='button'
                  onClick={() => removeItem(path)}
                  className='absolute right-2 top-2 z-10 rounded bg-black/70 px-2 text-xs text-white hover:bg-black'
                  title={t('dashboard.removeItem')}
                >
                  X
                </button>

                <div className='space-y-2'>
                  <div className='h-32 w-full shrink-0 overflow-hidden rounded border border-[var(--border)] bg-white'>
                    {(isImagePath(path) || isPdfPath(path)) ? (
                      previewByPath[path] ? (
                        <button
                          type='button'
                          className='h-full w-full cursor-zoom-in'
                          onClick={() => setExpandedPreviewPath(path)}
                          title={t('dashboard.openExpanded')}
                        >
                          <img src={previewByPath[path]} alt={getFileName(path)} className='h-full w-full object-cover' />
                        </button>
                      ) : (
                        <div className='flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-[var(--muted)]'>
                          {isPdfPath(path) ? 'PDF' : 'IMG'}
                        </div>
                      )
                    ) : (
                      <div className='flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-[var(--muted)]'>
                        {getFileExtension(path) || 'FILE'}
                      </div>
                    )}
                  </div>

                  <div className='min-w-0'>
                    <p className='truncate font-medium text-[var(--text)]'>{getFileName(path)}</p>
                    <p className='truncate text-xs'>{path}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {expandedPreviewPath && expandedPreviewSrc && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6'
          onClick={() => setExpandedPreviewPath(null)}
        >
          <div
            className='max-h-[90vh] max-w-[90vw] overflow-hidden rounded-lg border border-white/20 bg-black p-2'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='mb-2 flex items-center justify-between gap-3 text-sm text-white'>
              <p className='truncate'>{getFileName(expandedPreviewPath)}</p>
              <Button variant='secondary' onClick={() => setExpandedPreviewPath(null)}>
                {t('common.close')}
              </Button>
            </div>
            <img src={expandedPreviewSrc} alt={getFileName(expandedPreviewPath)} className='max-h-[82vh] max-w-[88vw] object-contain' />
          </div>
        </div>
      )}
    </div>
  )
}
