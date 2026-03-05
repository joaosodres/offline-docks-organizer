import { DragEvent, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, PanelLeft, Play, RefreshCw } from 'lucide-react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n/useI18n'
import { operationKeyFromId, operationOptions, type OperationId } from '@/lib/operations'
import { useJobStore } from '@/stores/useJobStore'
import { useSelectionStore } from '@/stores/useSelectionStore'
import { useUiStore } from '@/stores/useUiStore'

type FolderNode = {
  name: string
  path: string
  type: 'folder'
}

type FileNode = {
  name: string
  path: string
  type: 'file'
}

type ExplorerNode = FolderNode | FileNode

type DirectoryListing = {
  currentPath: string
  parentPath: string | null
  folders: FolderNode[]
  files: FileNode[]
}

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

export function OrganizerPage() {
  const { t, language } = useI18n()
  const jobs = useJobStore((state) => state.jobs)
  const selectedPaths = useSelectionStore((state) => state.selectedPaths)
  const setSelectedPaths = useSelectionStore((state) => state.setSelectedPaths)
  const lastOutputPath = useUiStore((state) => state.lastOutputPath)
  const lastError = useUiStore((state) => state.lastError)
  const setLastError = useUiStore((state) => state.setLastError)

  const [rootPath, setRootPath] = useState('')
  const [treeByPath, setTreeByPath] = useState<Record<string, ExplorerNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [operation, setOperation] = useState<OperationId>('batch_rename')
  const [renamePattern, setRenamePattern] = useState('{name}_{seq}')
  const [isStarting, setIsStarting] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [previewByPath, setPreviewByPath] = useState<Record<string, string>>({})
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const previewByPathRef = useRef<Record<string, string>>({})
  const selectedPathsRef = useRef<string[]>([])

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'idle').slice(0, 5),
    [jobs],
  )

  const toolkit = window.toolkit

  const loadDirectory = async (targetPath: string): Promise<DirectoryListing> => {
    const data = (await toolkit.organizer.list(targetPath)) as DirectoryListing
    const entries = [...data.folders, ...data.files]
    setTreeByPath((prev) => ({ ...prev, [data.currentPath]: entries }))
    return data
  }

  const loadTree = async (startPath: string) => {
    setIsLoadingTree(true)
    try {
      const nextTree: Record<string, ExplorerNode[]> = {}
      const nextExpanded = new Set<string>()

      const walk = async (targetPath: string): Promise<void> => {
        const data = (await toolkit.organizer.list(targetPath)) as DirectoryListing
        const entries = [...data.folders, ...data.files]
        nextTree[data.currentPath] = entries
        nextExpanded.add(data.currentPath)

        for (const folder of data.folders) {
          await walk(folder.path)
        }
      }

      await walk(startPath)
      setRootPath(startPath)
      setTreeByPath(nextTree)
      setExpandedPaths(nextExpanded)
    } finally {
      setIsLoadingTree(false)
    }
  }

  useEffect(() => {
    previewByPathRef.current = previewByPath
  }, [previewByPath])

  useEffect(() => {
    selectedPathsRef.current = selectedPaths
  }, [selectedPaths])

  useEffect(() => {
    const init = async () => {
      const home = await toolkit.organizer.getHome()
      await loadTree(home)
    }
    init()
  }, [toolkit])

  useEffect(() => {
    if (!toolkit?.getImagePreview) return

    let isDisposed = false
    const previewablePaths = selectedPaths.filter((filePath) => isImagePath(filePath) || isPdfPath(filePath))

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

    const unsubscribe = toolkit.onJobResult(() => {
      if (selectedPathsRef.current.length === 0) return
      const shouldClear = window.confirm(t('dashboard.clearPrompt'))
      if (shouldClear) setSelectedPaths([])
    })

    return () => unsubscribe()
  }, [setSelectedPaths, t, toolkit])

  const toggleSelected = (targetPath: string) => {
    setSelectedPaths(
      selectedPaths.includes(targetPath)
        ? selectedPaths.filter((item) => item !== targetPath)
        : [...selectedPaths, targetPath],
    )
  }

  const toggleFolder = async (folderPath: string) => {
    if (!treeByPath[folderPath]) {
      await loadDirectory(folderPath)
    }

    setExpandedPaths((previous) => {
      const next = new Set(previous)
      if (next.has(folderPath)) {
        next.delete(folderPath)
        return next
      }

      next.add(folderPath)
      return next
    })
  }

  const pickPaths = async () => {
    const paths = await toolkit?.pickPaths?.()
    if (!paths) return
    setSelectedPaths(paths)
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

  const runJob = async () => {
    if (selectedPaths.length === 0) return

    setIsStarting(true)
    setLastError(null)

    try {
      await toolkit.startJob({
        name: `Workspace ${new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`,
        operation,
        paths: selectedPaths,
        renamePattern,
      })
    } finally {
      setIsStarting(false)
    }
  }

  const expandedPreviewSrc = expandedPreviewPath ? previewByPath[expandedPreviewPath] : null

  const renderTree = (targetPath: string, depth: number) => {
    const nodes = treeByPath[targetPath] || []

    return nodes.map((node) => {
      const isFolder = node.type === 'folder'
      const isExpanded = isFolder ? expandedPaths.has(node.path) : false
      const isSelected = selectedPaths.includes(node.path)

      return (
        <div key={node.path} className='space-y-1'>
          <div
            className={[
              'flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-black/5',
              isSelected ? 'bg-[var(--surface-2)]' : '',
            ].join(' ')}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isFolder ? (
              <button
                type='button'
                className='w-5 text-left text-xs text-[var(--muted)]'
                onClick={() => toggleFolder(node.path)}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className='inline-block w-5 text-center text-xs text-[var(--muted)]'>•</span>
            )}

            <input
              type='checkbox'
              checked={isSelected}
              onChange={() => toggleSelected(node.path)}
              className='h-4 w-4 rounded border-[var(--border)]'
            />

            <button
              type='button'
              className='min-w-0 flex-1 truncate text-left'
              onClick={() => isFolder ? toggleFolder(node.path) : toggleSelected(node.path)}
              title={node.path}
            >
              {node.name}
            </button>
          </div>

          {isFolder && isExpanded && treeByPath[node.path] && (
            <div>{renderTree(node.path, depth + 1)}</div>
          )}
        </div>
      )
    })
  }

  return (
    <div className='space-y-5'>
      <header className='rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-6 py-5 shadow-sm'>
        <div className='flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between'>
          <div className='space-y-1'>
            <p className='text-xs uppercase tracking-[0.24em] text-[var(--muted)]'>{t('app.product')}</p>
            <h2 className='text-3xl font-semibold'>{t('organizer.title')}</h2>
            <p className='text-sm text-[var(--muted)]'>{t('organizer.subtitle')}</p>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button variant='secondary' onClick={pickPaths}>
              {t('dashboard.selectButton')}
            </Button>
            <Button
              variant='secondary'
              onClick={async () => {
                const folder = await toolkit.organizer.pickFolder()
                if (!folder) return
                await loadTree(folder)
                setSelectedPaths([])
              }}
            >
              <FolderOpen size={16} />
              {t('organizer.actions.pickRoot')}
            </Button>
            <Button variant='secondary' onClick={() => rootPath && loadTree(rootPath)} disabled={!rootPath || isLoadingTree}>
              <RefreshCw size={16} className={isLoadingTree ? 'animate-spin' : ''} />
              {t('organizer.actions.refresh')}
            </Button>
            <Button onClick={runJob} disabled={selectedPaths.length === 0 || isStarting}>
              <Play size={16} />
              {isStarting ? t('dashboard.starting') : t('organizer.actions.runHere')}
            </Button>
          </div>
        </div>
      </header>

      <div className='grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]'>
        <Card className='flex h-[calc(100vh-13rem)] flex-col gap-3 overflow-hidden'>
          <div className='flex items-center justify-between gap-2'>
            <div className='min-w-0'>
              <div className='flex items-center gap-2'>
                <PanelLeft size={16} className='text-[var(--muted)]' />
                <p className='font-medium'>{t('organizer.folders')}</p>
              </div>
              <p className='truncate text-xs text-[var(--muted)]'>{rootPath || t('common.notAvailable')}</p>
            </div>
            <span className='rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--muted)]'>
              {selectedPaths.length} {t('organizer.selectedCount').toLowerCase()}
            </span>
          </div>

          <div className='overflow-auto pr-1'>
            {rootPath && treeByPath[rootPath] ? (
              renderTree(rootPath, 0)
            ) : (
              <p className='text-xs text-[var(--muted)]'>{t('organizer.emptyEntries')}</p>
            )}
          </div>
        </Card>

        <div className='grid h-[calc(100vh-13rem)] gap-4 xl:grid-rows-[auto_auto_1fr]'>
          <Card className='space-y-4'>
            <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]'>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={[
                  'rounded-2xl border border-dashed p-6 transition-colors',
                  isDragActive ? 'border-[var(--primary)] bg-cyan-50' : 'border-[var(--border)] bg-[var(--surface-2)]',
                ].join(' ')}
              >
                <p className='font-medium'>{t('dashboard.dropTitle')}</p>
                <p className='mt-1 text-sm text-[var(--muted)]'>{t('dashboard.dropSubtitle')}</p>
              </div>

              <div className='grid gap-3 text-sm'>
                <div className='grid gap-1'>
                  <label htmlFor='workspace-operation' className='font-medium'>{t('common.operation')}</label>
                  <select
                    id='workspace-operation'
                    value={operation}
                    onChange={(event) => setOperation(event.target.value as OperationId)}
                    className='w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm'
                  >
                    {operationOptions.map((option) => (
                      <option key={option.id} value={option.id}>{t(option.translationKey)}</option>
                    ))}
                  </select>
                </div>

                {(operation === 'batch_rename' || operation === 'merge_pdf_rename' || operation === 'images_to_pdf') && (
                  <div className='grid gap-1'>
                    <label htmlFor='workspace-pattern' className='font-medium'>
                      {operation === 'batch_rename' ? t('dashboard.renamePattern') : t('dashboard.outputPattern')}
                    </label>
                    <input
                      id='workspace-pattern'
                      className='w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm'
                      value={renamePattern}
                      onChange={(event) => setRenamePattern(event.target.value)}
                      placeholder='{name}_{seq}'
                    />
                    <p className='text-xs text-[var(--muted)]'>{t('dashboard.tokens')} {'{name}'} {'{seq}'} {'{date}'}</p>
                  </div>
                )}
              </div>
            </div>

            <div className='grid gap-3 xl:grid-cols-2'>
              <div className='rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <p className='font-medium'>{t('dashboard.liveProgress')}</p>
                <div className='mt-2 space-y-2'>
                  {activeJobs.length === 0 && <p className='text-xs text-[var(--muted)]'>{t('dashboard.noActiveJobs')}</p>}
                  {activeJobs.map((job) => (
                    <div key={job.id} className='rounded-xl border border-[var(--border)] bg-white p-2'>
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

              <div className='space-y-2'>
                {lastOutputPath && (
                  <div className='rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm'>
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
                  <div className='rounded-2xl border border-rose-300 bg-rose-50 p-3 text-sm'>
                    <div className='flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='font-medium text-rose-900'>{t('dashboard.processingError')} {t(operationKeyFromId(lastError.operation))}</p>
                        <p className='mt-1 text-rose-800'>{lastError.message}</p>
                      </div>
                      <Button variant='secondary' onClick={() => setLastError(null)}>
                        {t('common.close')}
                      </Button>
                    </div>
                    <pre className='mt-2 max-h-32 overflow-auto rounded-xl bg-white p-2 text-xs text-rose-900'>{lastError.detail}</pre>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className='min-h-0 space-y-3'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='font-medium'>{t('dashboard.selectedFiles')} ({selectedPaths.length})</h3>
              <Button variant='secondary' onClick={() => setSelectedPaths([])} disabled={selectedPaths.length === 0}>
                {t('organizer.actions.clearSelection')}
              </Button>
            </div>

            <ul className='grid min-h-0 grid-cols-1 gap-3 overflow-auto pr-1 text-sm text-[var(--muted)] md:grid-cols-2 2xl:grid-cols-3'>
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
                    'relative rounded-2xl border bg-[var(--surface-2)] p-3',
                    dragOverPath === path ? 'border-[var(--primary)]' : 'border-[var(--border)]',
                  ].join(' ')}
                >
                  <button
                    type='button'
                    onClick={() => removeItem(path)}
                    className='absolute right-2 top-2 z-10 rounded-full bg-black/70 px-2 text-xs text-white hover:bg-black'
                    title={t('dashboard.removeItem')}
                  >
                    X
                  </button>

                  <div className='space-y-2'>
                    <div className='h-32 w-full shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-white'>
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
          </Card>
        </div>
      </div>

      {expandedPreviewPath && expandedPreviewSrc && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6'
          onClick={() => setExpandedPreviewPath(null)}
        >
          <div
            className='max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl border border-white/20 bg-black p-2'
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
