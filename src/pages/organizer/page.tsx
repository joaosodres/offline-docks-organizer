import { DragEvent, KeyboardEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { File, FileImage, FileText, Folder, FolderOpen, PanelLeft, Play, RefreshCw } from 'lucide-react'
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

type ContextMenuState = {
  node: ExplorerNode
  x: number
  y: number
}

type RenameInlineState = {
  path: string
  value: string
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

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

async function getPdfPreview(pdfBase64: string) {
  try {
    const loadingTask = getDocument({ data: base64ToUint8Array(pdfBase64) })
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

function joinMacPath(basePath: string, child: string) {
  return basePath.endsWith('/') ? `${basePath}${child}` : `${basePath}/${child}`
}

function getParentPath(targetPath: string) {
  const normalized = targetPath.replaceAll('\\', '/')
  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex <= 0) return normalized
  return normalized.slice(0, lastSlashIndex)
}

function getEditableName(node: ExplorerNode) {
  if (node.type === 'folder') return node.name
  const extension = `.${getFileExtension(node.path)}`
  return extension && node.name.endsWith(extension)
    ? node.name.slice(0, -extension.length)
    : node.name
}

function applyPathReplacement(paths: string[], previousPath: string, nextPath: string) {
  return paths.map((item) => item === previousPath ? nextPath : item)
}

function getNodeIcon(node: ExplorerNode) {
  if (node.type === 'folder') return Folder
  if (isPdfPath(node.path)) return FileText
  if (isImagePath(node.path)) return FileImage
  return File
}

function getPathIcon(targetPath: string) {
  if (isPdfPath(targetPath)) return FileText
  if (isImagePath(targetPath)) return FileImage
  return File
}

const INTERNAL_APP_DRAG_TYPE = 'application/x-offline-docs-paths'

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
  const [explorerSelectedPaths, setExplorerSelectedPaths] = useState<string[]>([])
  const [operation, setOperation] = useState<OperationId>('batch_rename')
  const [renamePattern, setRenamePattern] = useState('{name}_{seq}')
  const [isStarting, setIsStarting] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [previewByPath, setPreviewByPath] = useState<Record<string, string>>({})
  const [previewLoadingByPath, setPreviewLoadingByPath] = useState<Record<string, boolean>>({})
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameInline, setRenameInline] = useState<RenameInlineState | null>(null)
  const previewByPathRef = useRef<Record<string, string>>({})
  const previewLoadingByPathRef = useRef<Record<string, boolean>>({})
  const rootPathRef = useRef('')
  const selectedPathsRef = useRef<string[]>([])
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameStartedForPathRef = useRef<string | null>(null)

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'running' || job.status === 'idle').slice(0, 5),
    [jobs],
  )

  const toolkit = window.toolkit

  const visibleFilePaths = useMemo(() => {
    const result: string[] = []

    const walk = (targetPath: string) => {
      const nodes = treeByPath[targetPath] || []
      for (const node of nodes) {
        if (node.type === 'file') result.push(node.path)
        if (node.type === 'folder' && expandedPaths.has(node.path)) {
          walk(node.path)
        }
      }
    }

    if (rootPath) walk(rootPath)
    return result
  }, [expandedPaths, rootPath, treeByPath])

  const loadDirectory = useCallback(async (targetPath: string): Promise<DirectoryListing> => {
    const data = (await toolkit.organizer.list(targetPath)) as DirectoryListing
    const entries = [...data.folders, ...data.files]
    setTreeByPath((prev) => ({ ...prev, [data.currentPath]: entries }))
    return data
  }, [toolkit])

  const loadTree = async (startPath: string) => {
    setIsLoadingTree(true)
    setRootPath(startPath)
    try {
      const rootData = await loadDirectory(startPath)
      setExpandedPaths(new Set([rootData.currentPath]))
    } finally {
      setIsLoadingTree(false)
    }
  }

  useEffect(() => {
    selectedPathsRef.current = selectedPaths
  }, [selectedPaths])

  useEffect(() => {
    setExplorerSelectedPaths((previous) => previous.filter((item) => visibleFilePaths.includes(item)))
  }, [visibleFilePaths])

  useEffect(() => {
    rootPathRef.current = rootPath
  }, [rootPath])

  useEffect(() => {
    previewByPathRef.current = previewByPath
  }, [previewByPath])

  useEffect(() => {
    previewLoadingByPathRef.current = previewLoadingByPath
  }, [previewLoadingByPath])

  useEffect(() => {
    if (!contextMenu) return

    const closeMenu = () => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!renameInline || !renameInputRef.current) {
      renameStartedForPathRef.current = null
      return
    }
    if (renameStartedForPathRef.current === renameInline.path) return
    renameStartedForPathRef.current = renameInline.path
    renameInputRef.current.focus()
    renameInputRef.current.select()
  }, [renameInline])

  useEffect(() => {
    const init = async () => {
      const home = await toolkit.organizer.getHome()
      const desktopPath = joinMacPath(home, 'Desktop')

      try {
        await loadTree(desktopPath)
      } catch {
        await loadTree(home)
      }
    }
    init()
  }, [toolkit])

  const handleExplorerSelection = (targetPath: string, event: MouseEvent<HTMLButtonElement>) => {
    const isRangeSelection = event.shiftKey
    const isMultiSelection = event.metaKey || event.ctrlKey

    setExplorerSelectedPaths((previous) => {
      if (isRangeSelection && previous.length > 0) {
        const anchorPath = previous[previous.length - 1]
        const anchorIndex = visibleFilePaths.indexOf(anchorPath)
        const targetIndex = visibleFilePaths.indexOf(targetPath)

        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] = anchorIndex < targetIndex
            ? [anchorIndex, targetIndex]
            : [targetIndex, anchorIndex]
          const rangePaths = visibleFilePaths.slice(start, end + 1)
          return [...new Set([...previous, ...rangePaths])]
        }
      }

      if (isMultiSelection) {
        return previous.includes(targetPath)
          ? previous.filter((item) => item !== targetPath)
          : [...previous, targetPath]
      }

      return [targetPath]
    })
  }

  const addExplorerSelection = () => {
    if (explorerSelectedPaths.length === 0) return

    setSelectedPaths([...new Set([...selectedPaths, ...explorerSelectedPaths])])
  }

  const createSubfolder = async (node: ExplorerNode) => {
    if (node.type !== 'folder') return

    setExpandedPaths((previous) => {
      const next = new Set(previous)
      next.add(node.path)
      return next
    })

    const createdPath = await toolkit.organizer.createFolder({
      parentPath: node.path,
      name: 'Nova pasta',
    })

    await refreshTreeFromPaths([createdPath])
    setRenameInline({
      path: createdPath,
      value: 'Nova pasta',
    })
  }

  const startInlineRename = (node: ExplorerNode) => {
    setContextMenu(null)
    setRenameInline({
      path: node.path,
      value: getEditableName(node),
    })
  }

  const renameExplorerNode = async (node: ExplorerNode, nextBaseName: string) => {
    const normalizedName = nextBaseName.trim()
    if (!normalizedName) {
      setRenameInline(null)
      return
    }

    if (normalizedName === getEditableName(node)) {
      setRenameInline(null)
      return
    }

    const nextBaseValue = normalizedName

    const nextName = node.type === 'file'
      ? `${nextBaseValue}.${getFileExtension(node.path)}`
      : nextBaseValue

    const nextPath = await toolkit.organizer.renamePath({
      targetPath: node.path,
      newName: nextName,
    })

    await refreshTreeFromPaths([node.path, nextPath])

    setExplorerSelectedPaths((previous) => applyPathReplacement(previous, node.path, nextPath))
    setSelectedPaths(applyPathReplacement(selectedPathsRef.current, node.path, nextPath))
    setPreviewByPath((previous) => {
      if (!previous[node.path]) return previous
      const next = { ...previous, [nextPath]: previous[node.path] }
      delete next[node.path]
      return next
    })
    setPreviewLoadingByPath((previous) => {
      if (!previous[node.path]) return previous
      const next = { ...previous, [nextPath]: previous[node.path] }
      delete next[node.path]
      return next
    })
    if (expandedPreviewPath === node.path) setExpandedPreviewPath(nextPath)
    setRenameInline(null)
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

    const internalPayload = event.dataTransfer.getData(INTERNAL_APP_DRAG_TYPE)
    if (internalPayload) {
      try {
        const internalPaths = JSON.parse(internalPayload) as string[]
        if (internalPaths.length > 0) {
          setSelectedPaths([...new Set([...selectedPaths, ...internalPaths])])
          return
        }
      } catch {
        // Fall back to external drag/drop parsing below.
      }
    }

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

  const handleExplorerDragStart = (event: DragEvent<HTMLDivElement>, targetPath: string) => {
    const dragPaths = explorerSelectedPaths.includes(targetPath) && explorerSelectedPaths.length > 1
      ? explorerSelectedPaths
      : [targetPath]

    event.dataTransfer.setData(INTERNAL_APP_DRAG_TYPE, JSON.stringify(dragPaths))
    event.dataTransfer.setData('text/plain', dragPaths.join('\n'))
    event.dataTransfer.effectAllowed = 'copy'
  }

  const handleExplorerKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: ExplorerNode) => {
    if (node.type === 'folder') return
    if (renameInline?.path === node.path) return

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      startInlineRename(node)
    }
  }

  const handleNativeDragStart = (event: DragEvent<HTMLLIElement>, targetPath: string) => {
    const dragPaths = selectedPaths.includes(targetPath) && selectedPaths.length > 1
      ? selectedPaths
      : [targetPath]

    setDraggedPath(targetPath)
    event.dataTransfer.setData(INTERNAL_APP_DRAG_TYPE, JSON.stringify(dragPaths))
    event.dataTransfer.setData('text/plain', dragPaths.join('\n'))
    event.dataTransfer.effectAllowed = 'copyMove'
    toolkit.startNativeDrag(dragPaths)
  }

  const removeItem = (targetPath: string) => {
    setSelectedPaths(selectedPaths.filter((path) => path !== targetPath))
  }

  const loadPreview = useCallback(async (targetPath: string) => {
    if (previewByPathRef.current[targetPath] || previewLoadingByPathRef.current[targetPath]) return

    setPreviewLoadingByPath((previous) => ({ ...previous, [targetPath]: true }))

    try {
      const preview = isImagePath(targetPath)
        ? await toolkit.getImagePreview(targetPath)
        : isPdfPath(targetPath)
          ? await toolkit.getPdfBuffer(targetPath).then((pdfBase64) => pdfBase64 ? getPdfPreview(pdfBase64) : null)
          : null

      if (preview) {
        setPreviewByPath((previous) => ({ ...previous, [targetPath]: preview }))
      }
    } finally {
      setPreviewLoadingByPath((previous) => ({ ...previous, [targetPath]: false }))
    }
  }, [toolkit])

  const refreshTreeFromPaths = useCallback(async (paths: string[]) => {
    const currentRoot = rootPathRef.current
    if (!currentRoot || paths.length === 0) return

    const directories = [...new Set(paths.map(getParentPath))]
      .filter((directoryPath) => directoryPath.startsWith(currentRoot))

    await Promise.all(directories.map(async (directoryPath) => {
      try {
        await loadDirectory(directoryPath)
      } catch {
        setTreeByPath((previous) => {
          const next = { ...previous }
          delete next[directoryPath]
          return next
        })
      }
    }))

    if (directories.length > 0) {
      try {
        await loadDirectory(currentRoot)
      } catch {
        // Ignore root refresh failures and keep the current tree visible.
      }
    }
  }, [loadDirectory])

  useEffect(() => {
    if (!toolkit?.onJobResult) return

    const unsubscribe = toolkit.onJobResult((payload) => {
      const previousSelection = selectedPathsRef.current
      const nextSelection = payload.paths && payload.paths.length > 0 ? payload.paths : previousSelection

      void refreshTreeFromPaths([...previousSelection, ...nextSelection])

      if (previousSelection.length === 0) return
      setSelectedPaths([])
      setExplorerSelectedPaths([])
    })

    return () => unsubscribe()
  }, [refreshTreeFromPaths, setSelectedPaths, t, toolkit])

  useEffect(() => {
    const previewablePaths = selectedPaths.filter((filePath) => isImagePath(filePath) || isPdfPath(filePath))

    setPreviewByPath((previous) => {
      const next: Record<string, string> = {}
      for (const filePath of previewablePaths) {
        if (previous[filePath]) next[filePath] = previous[filePath]
      }
      return next
    })

    setPreviewLoadingByPath((previous) => {
      const next: Record<string, boolean> = {}
      for (const filePath of previewablePaths) {
        if (previous[filePath]) next[filePath] = previous[filePath]
      }
      return next
    })

    for (const filePath of previewablePaths) {
      void loadPreview(filePath)
    }
  }, [selectedPaths, loadPreview])

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
      const isExplorerSelected = explorerSelectedPaths.includes(node.path)
      const isAdded = selectedPaths.includes(node.path)
      const isRenaming = renameInline?.path === node.path
      const Icon = getNodeIcon(node)

      return (
        <div key={node.path} className='space-y-1'>
          <div
            draggable={!isFolder}
            tabIndex={isFolder ? -1 : 0}
            onDragStart={(event) => {
              if (isFolder) return
              handleExplorerDragStart(event, node.path)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu({
                node,
                x: event.clientX,
                y: event.clientY,
              })
            }}
            onClick={(event) => {
              if (isFolder) return
              handleExplorerSelection(node.path, event as unknown as MouseEvent<HTMLButtonElement>)
            }}
            onDoubleClick={() => isFolder && toggleFolder(node.path)}
            onKeyDown={(event) => handleExplorerKeyDown(event, node)}
            className={[
              'flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-[13px] transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-cyan-100',
              isExplorerSelected
                ? 'border-[var(--primary)] bg-cyan-50 text-[var(--text)]'
                : 'border-transparent',
            ].join(' ')}
          >
            <span
              aria-hidden='true'
              className='shrink-0'
              style={{ width: `${depth * 14}px` }}
            />

            {isFolder ? (
              <button
                type='button'
                className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs text-[var(--muted)] hover:bg-black/5'
                onClick={(event) => {
                  event.stopPropagation()
                  toggleFolder(node.path)
                }}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className='h-6 w-6 shrink-0' />
            )}

            <span className={[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
              isFolder
                ? 'border-amber-200 bg-amber-50 text-amber-600'
                : isPdfPath(node.path)
                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                  : isImagePath(node.path)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                    : 'border-slate-200 bg-slate-50 text-slate-500',
            ].join(' ')}>
              <Icon size={13} />
            </span>

            <div className='min-w-0 flex-1 truncate' title={node.path}>
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameInline.value}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setRenameInline({ path: node.path, value: event.target.value })}
                  onBlur={() => void renameExplorerNode(node, renameInline.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void renameExplorerNode(node, renameInline.value)
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setRenameInline(null)
                    }
                  }}
                  className='w-full rounded-md border border-transparent bg-white/80 px-1.5 py-0.5 text-[13px] text-[var(--text)] outline-none ring-0 shadow-[0_0_0_1px_rgba(14,165,233,0.28)]'
                />
              ) : (
                node.name
              )}
            </div>

            {isAdded && (
              <span className='rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700'>
                Na lista
              </span>
            )}
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
            <div className='flex items-center gap-2'>
              <Button
                variant='secondary'
                className='h-8 px-3 text-xs'
                onClick={addExplorerSelection}
                disabled={explorerSelectedPaths.length === 0}
              >
                Adicionar selecionados
              </Button>
            </div>
          </div>

          <div className='overflow-auto pr-1'>
            {isLoadingTree && !treeByPath[rootPath] && (
              <p className='mb-2 text-xs text-[var(--muted)]'>Carregando pastas do Mac...</p>
            )}
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
                  onDragStart={(event) => handleNativeDragStart(event, path)}
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
                          <button
                            type='button'
                            className='flex h-full w-full items-center justify-center px-3 text-center text-xs font-semibold uppercase text-[var(--muted)]'
                            onClick={() => loadPreview(path)}
                          >
                            {previewLoadingByPath[path] ? 'Carregando...' : isPdfPath(path) ? 'Carregar PDF' : 'Carregar imagem'}
                          </button>
                        )
                      ) : (
                        <div className='flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-[var(--muted)]'>
                          {getFileExtension(path) || 'FILE'}
                        </div>
                      )}
                    </div>

                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        {(() => {
                          const Icon = getPathIcon(path)
                          return (
                            <span className={[
                              'flex h-8 w-8 items-center justify-center rounded-lg border',
                              isPdfPath(path)
                                ? 'border-rose-200 bg-rose-50 text-rose-600'
                                : isImagePath(path)
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                  : 'border-slate-200 bg-slate-50 text-slate-500',
                            ].join(' ')}>
                              <Icon size={16} />
                            </span>
                          )
                        })()}
                        <p className='truncate font-medium text-[var(--text)]'>{getFileName(path)}</p>
                      </div>
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

      {contextMenu && (
        <div
          className='fixed z-50 min-w-48 rounded-xl border border-[var(--border)] bg-white p-1 shadow-lg'
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type='button'
            className='flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]'
            onClick={() => {
              startInlineRename(contextMenu.node)
            }}
          >
            Renomear
          </button>
          {contextMenu.node.type === 'folder' && (
            <button
              type='button'
              className='flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]'
              onClick={async () => {
                const folderNode = contextMenu.node
                setContextMenu(null)
                await createSubfolder(folderNode)
              }}
            >
              Nova subpasta
            </button>
          )}
          <button
            type='button'
            className='flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]'
            onClick={() => {
              toolkit.revealInFolder(contextMenu.node.path)
              setContextMenu(null)
            }}
          >
            Mostrar na pasta
          </button>
        </div>
      )}

    </div>
  )
}
