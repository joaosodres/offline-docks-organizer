import { DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId, operationOptions, type OperationId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'
import { usePresetStore } from '@/stores/usePresetStore'
import { useSelectionStore } from '@/stores/useSelectionStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useUiStore } from '@/stores/useUiStore'

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif'])
const pdfExtensions = new Set(['pdf'])

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
  const settings = useSettingsStore((state) => state.settings)
  const presets = usePresetStore((state) => state.presets)
  const upsertPreset = usePresetStore((state) => state.upsertPreset)
  const removePreset = usePresetStore((state) => state.removePreset)
  const [renamePattern, setRenamePattern] = useState(settings.defaultRenamePattern)
  const [presetId, setPresetId] = useState('none')
  const [presetName, setPresetName] = useState('')
  const [isPicking, setIsPicking] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [previewByPath, setPreviewByPath] = useState<Record<string, string>>({})
  const previewByPathRef = useRef<Record<string, string>>({})
  const selectedPathsRef = useRef<string[]>([])
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const [expandedPdfUrl, setExpandedPdfUrl] = useState<string | null>(null)
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
    setRenamePattern((current) => current || settings.defaultRenamePattern)
  }, [settings.defaultRenamePattern])

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
          : await toolkit.getPdfPreview(filePath)
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

  useEffect(() => {
    if (!expandedPreviewPath) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedPreviewPath(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedPreviewPath])

  useEffect(() => {
    if (!expandedPreviewPath || !isPdfPath(expandedPreviewPath)) {
      setExpandedPdfUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return null
      })
      return
    }

    let isDisposed = false

    const loadExpandedPdf = async () => {
      const pdfData = await toolkit.getPdfBuffer(expandedPreviewPath)
      if (!pdfData || isDisposed) return

      const normalizedPdfData = new Uint8Array(pdfData)
      const nextUrl = URL.createObjectURL(new Blob([normalizedPdfData], { type: 'application/pdf' }))
      setExpandedPdfUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return nextUrl
      })
    }

    void loadExpandedPdf()

    return () => {
      isDisposed = true
    }
  }, [expandedPreviewPath, toolkit])

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

  const startJob = async (dryRun = false) => {
    if (!selectedPaths.length) return

    setIsStarting(true)
    setLastError(null)
    try {
      const job = await toolkit?.startJob?.({
        name: `Batch ${new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`,
        operation,
        paths: selectedPaths,
        renamePattern,
        dryRun,
      })
      if (!job) return
      upsertJob(job)
    } finally {
      setIsStarting(false)
    }
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return

    const nextId = presetId !== 'none' ? presetId : crypto.randomUUID()
    upsertPreset({
      id: nextId,
      name,
      operation,
      renamePattern,
    })
    setPresetId(nextId)
    setPresetName('')
  }

  const applyPreset = (nextPresetId: string) => {
    setPresetId(nextPresetId)
    if (nextPresetId === 'none') return

    const preset = presets.find((item) => item.id === nextPresetId)
    if (!preset) return
    setOperation(preset.operation as OperationId)
    setRenamePattern(preset.renamePattern)
    setPresetName(preset.name)
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
  const expandedPreviewIsPdf = expandedPreviewPath ? isPdfPath(expandedPreviewPath) : false
  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'idle').slice(0, 5),
    [jobs],
  )

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className='h-full overflow-y-auto overflow-x-hidden'
    >
      <div className='mx-auto max-w-6xl space-y-6 px-6 py-8'>
        <header className='mb-8 space-y-2'>
          <h2 className='text-3xl font-bold tracking-tight text-white'>{t('dashboard.title')}</h2>
          <p className='text-base text-[var(--muted)]'>{t('dashboard.subtitle')}</p>
        </header>

      <div className='grid gap-6 lg:grid-cols-3'>
        <div className='lg:col-span-2 space-y-6'>
          <Card className='space-y-6 p-8 relative overflow-hidden'>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                'relative overflow-hidden flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-300',
                isDragActive
                  ? 'border-cyan-400 bg-cyan-950/20'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/5',
              ].join(' ')}
            >
              {isDragActive && (
                <motion.div 
                  layoutId='glow' 
                  className='absolute inset-0 bg-cyan-400/5 blur-2xl'
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              )}
              <div className='relative z-10'>
                <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5 shadow-inner'>
                  <svg className='h-8 w-8 text-cyan-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={1.5} d='M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' />
                  </svg>
                </div>
                <p className='text-lg font-medium text-white'>{t('dashboard.dropTitle')}</p>
                <p className='mt-1 text-sm text-[var(--muted)]'>{t('dashboard.dropSubtitle')}</p>
                <div className='mt-6 flex items-center justify-center gap-3'>
                  <Button variant='secondary' onClick={pickPaths} disabled={isPicking}>
                    {isPicking ? t('dashboard.selecting') : t('dashboard.selectButton')}
                  </Button>
                </div>
              </div>
            </div>

            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <label htmlFor='operation' className='text-sm font-medium text-[var(--muted)]'>
                  {t('common.operation')}
                </label>
                <Select value={operation} onValueChange={(value) => setOperation(value as OperationId)}>
                  <SelectTrigger id='operation'>
                    <SelectValue placeholder={t('common.operation')} />
                  </SelectTrigger>
                  <SelectContent>
                    {operationOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {t(option.translationKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(operation === 'batch_rename' || operation === 'merge_pdf_rename' || operation === 'images_to_pdf') && (
                <div className='space-y-2'>
                  <label htmlFor='renamePattern' className='text-sm font-medium text-[var(--muted)]'>
                    {operation === 'batch_rename' ? t('dashboard.renamePattern') : t('dashboard.outputPattern')}
                  </label>
                  <input
                    id='renamePattern'
                    value={renamePattern}
                    onChange={(event) => setRenamePattern(event.target.value)}
                    className='w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-white/20 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-colors'
                    placeholder='{name}_{seq}'
                  />
                  <div className='flex flex-col gap-1'>
                    <p className='text-[11px] text-[var(--muted)]'>{t('dashboard.tokens')} <code className='rounded bg-white/10 px-1 py-0.5 text-cyan-400'>{"{name}"}</code> <code className='rounded bg-white/10 px-1 py-0.5 text-cyan-400'>{"{seq}"}</code> <code className='rounded bg-white/10 px-1 py-0.5 text-cyan-400'>{"{date}"}</code></p>
                    {operation === 'batch_rename' && (
                      <p className='text-[11px] text-[var(--muted)]'>{t('dashboard.renameDestination')} • {t('dashboard.renameOrderHint')}</p>
                    )}
                    {operation === 'merge_pdf_rename' && (
                      <p className='text-[11px] text-[var(--muted)]'>{t('dashboard.mergeDestination')}</p>
                    )}
                    {operation === 'images_to_pdf' && (
                      <p className='text-[11px] text-[var(--muted)]'>{t('dashboard.imagesPdfDestination')}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className='grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'>
              <div className='space-y-2'>
                <label className='text-sm font-medium text-[var(--muted)]'>Preset</label>
                <Select value={presetId} onValueChange={applyPreset}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select preset' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>No preset</SelectItem>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <label htmlFor='presetName' className='text-sm font-medium text-[var(--muted)]'>
                  Preset name
                </label>
                <input
                  id='presetName'
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  className='w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder-white/20 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 transition-colors'
                  placeholder='Monthly receipts'
                />
              </div>

              <div className='flex items-end gap-2'>
                <Button variant='secondary' onClick={savePreset} disabled={!presetName.trim()}>
                  Save
                </Button>
                {presetId !== 'none' && (
                  <Button
                    variant='ghost'
                    onClick={() => {
                      removePreset(presetId)
                      setPresetId('none')
                    }}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>

            <div className='flex flex-wrap justify-end gap-3 pt-2 border-t border-white/5 mt-6'>
              <Button
                variant='secondary'
                onClick={() => startJob(true)}
                disabled={!canStart || operation !== 'batch_rename'}
                className='px-6 mt-6'
              >
                Dry run
              </Button>
              <Button onClick={() => startJob(false)} disabled={!canStart} className='px-8 mt-6'>
                {isStarting ? t('dashboard.starting') : t('dashboard.startButton')}
              </Button>
            </div>
          </Card>

          <div className='space-y-4'>
            <div className='flex items-center justify-between'>
              <h3 className='text-lg font-medium text-white'>{t('dashboard.selectedFiles')} <span className='ml-2 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-cyan-400'>{selectedPaths.length}</span></h3>
            </div>
            <ul className='grid max-h-[500px] grid-cols-1 gap-4 overflow-auto pr-2 sm:grid-cols-2 xl:grid-cols-3 custom-scrollbar'>
              <AnimatePresence>
                {selectedPaths.length === 0 && (
                  <motion.li 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className='col-span-full py-8 text-center text-sm text-[var(--muted)]'
                  >
                    {t('dashboard.noSelectedFiles')}
                  </motion.li>
                )}
                {selectedPaths.map((path, index) => (
                  <motion.li
                    key={path}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
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
                      'group relative flex flex-col overflow-hidden rounded-xl border bg-black/20 p-3 backdrop-blur-sm transition-all hover:bg-white/5',
                      dragOverPath === path ? 'border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-white/10 hover:border-white/20',
                    ].join(' ')}
                  >
                    <button
                      type='button'
                      onClick={() => removeItem(path)}
                      className='absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-md transition-opacity hover:bg-black group-hover:opacity-100'
                      title={t('dashboard.removeItem')}
                    >
                      <svg className='h-3 w-3' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' /></svg>
                    </button>

                    <div className='relative mb-3 h-32 w-full shrink-0 overflow-hidden rounded-lg bg-black/40'>
                      {(isImagePath(path) || isPdfPath(path)) ? (
                        previewByPath[path] ? (
                          <button
                            type='button'
                            className='group/img relative h-full w-full'
                            onClick={() => setExpandedPreviewPath(path)}
                            title={t('dashboard.openExpanded')}
                          >
                            <img src={previewByPath[path]} alt={getFileName(path)} className='h-full w-full object-cover transition-transform duration-500 group-hover/img:scale-110' />
                            <div className='absolute inset-0 bg-black/0 transition-colors group-hover/img:bg-black/20' />
                          </button>
                        ) : (
                          <div className='flex h-full w-full items-center justify-center text-xs font-bold tracking-widest text-[var(--muted)]'>
                            {isPdfPath(path) ? 'PDF' : 'IMG'}
                          </div>
                        )
                      ) : (
                        <div className='flex h-full w-full items-center justify-center text-xs font-bold tracking-widest text-[var(--muted)] uppercase'>
                          {getFileExtension(path) || 'FILE'}
                        </div>
                      )}
                    </div>

                    <div className='min-w-0 flex-1 space-y-1'>
                      <p className='truncate text-sm font-medium text-white' title={getFileName(path)}>{getFileName(path)}</p>
                      <p className='truncate text-[11px] text-[var(--muted)]' title={path}>{path}</p>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </div>

        {/* Right Column: Status and Errors */}
        <div className='space-y-6'>
          <Card className='space-y-4 p-6'>
            <div className='flex items-center gap-3 border-b border-white/5 pb-4'>
              <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-inner'>
                <svg className='h-4 w-4 text-white' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M13 10V3L4 14h7v7l9-11h-7z' /></svg>
              </div>
              <h3 className='font-medium text-white'>{t('dashboard.liveProgress')}</h3>
            </div>
            
            <div className='space-y-3'>
              <AnimatePresence>
                {activeJobs.map((job) => (
                  <motion.div 
                    key={job.id} 
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className='relative overflow-hidden rounded-xl border border-white/5 bg-white/5 p-4'
                  >
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <p className='truncate text-sm font-medium text-white'>{job.name}</p>
                      <span className='rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-400'>{t(`status.${job.status}`)}</span>
                    </div>
                    <p className='mb-3 truncate text-xs text-[var(--muted)]'>{t(operationKeyFromId(job.operation))}</p>
                    
                    {/* Replaced standard Progress with simple stylized bar since we don't know Progress internals */}
                    <div className='relative h-1.5 w-full overflow-hidden rounded-full bg-black/40'>
                      <motion.div 
                        className='absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400 to-blue-500' 
                        initial={{ width: 0 }}
                        animate={{ width: `${job.progress}%` }}
                        transition={{ ease: 'easeOut', duration: 0.5 }}
                      />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>

          <AnimatePresence>
            {lastOutputPath && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className='rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 shadow-lg shadow-emerald-500/5'
              >
                <div className='flex items-center gap-2 mb-2'>
                  <svg className='h-5 w-5 text-emerald-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' /></svg>
                  <p className='font-medium text-emerald-100'>{t('dashboard.lastOutput')}</p>
                </div>
                <p className='mb-4 mt-1 break-all text-xs text-emerald-200/70'>{lastOutputPath}</p>
                <Button variant='secondary' onClick={() => toolkit?.revealInFolder?.(lastOutputPath)} className='w-full'>
                  {t('dashboard.openInFinder')}
                </Button>
              </motion.div>
            )}

            {lastError && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className='rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 shadow-lg shadow-rose-500/5'
              >
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <svg className='h-5 w-5 text-rose-400' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' /></svg>
                      <p className='font-medium text-rose-100'>{t('dashboard.processingError')}</p>
                    </div>
                    <p className='mt-2 text-sm text-rose-200'>{lastError.message}</p>
                    <p className='mt-1 text-xs text-rose-400/70'>{new Date(lastError.at).toLocaleString()} • {t(operationKeyFromId(lastError.operation))}</p>
                  </div>
                </div>
                {lastError.detail && (
                  <div className='mt-3 overflow-hidden rounded-lg bg-black/40'>
                    <pre className='max-h-32 overflow-auto p-3 text-[10px] text-rose-300 custom-scrollbar'>{lastError.detail}</pre>
                  </div>
                )}
                <Button variant='secondary' onClick={() => setLastError(null)} className='mt-3 w-full border-rose-500/20 hover:bg-rose-500/10 hover:text-rose-100'>
                  {t('common.close')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {expandedPreviewPath && expandedPreviewSrc && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm'
            onClick={() => setExpandedPreviewPath(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className='relative flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-4 shadow-2xl'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='mb-4 flex items-center justify-between gap-4 border-b border-white/5 pb-4 text-sm text-white'>
                <p className='truncate font-medium'>{getFileName(expandedPreviewPath)}</p>
                <button 
                  type='button'
                  onClick={() => setExpandedPreviewPath(null)}
                  className='rounded-full bg-white/10 p-1.5 hover:bg-white/20 transition-colors'
                >
                  <svg className='h-4 w-4' fill='none' viewBox='0 0 24 24' stroke='currentColor'><path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' /></svg>
                </button>
              </div>
              <div className={[
                'relative flex flex-1 min-h-0 items-center justify-center overflow-hidden rounded-xl',
                expandedPreviewIsPdf ? 'bg-[#111827] p-6' : 'bg-black/50 p-3',
              ].join(' ')}>
                {expandedPreviewIsPdf ? (
                  expandedPdfUrl ? (
                    <iframe
                      src={`${expandedPdfUrl}#view=FitH`}
                      title={getFileName(expandedPreviewPath)}
                      className='h-[78vh] w-[min(88vw,980px)] rounded-lg border border-white/10 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]'
                    />
                    ) : (
                      <div className='flex h-[78vh] w-[min(88vw,980px)] items-center justify-center rounded-lg border border-white/10 bg-zinc-950 text-sm text-zinc-400'>
                      {t('organizer.pdfLoading')}
                      </div>
                    )
                ) : (
                  <img
                    src={expandedPreviewSrc}
                    alt={getFileName(expandedPreviewPath)}
                    className='h-full w-full object-contain'
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </motion.div>
  )
}
