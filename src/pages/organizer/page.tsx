import { DragEvent, KeyboardEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, File, FileImage, FileText, Folder, FolderOpen, PanelLeft, Play, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

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
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null)
  const [previewByPath, setPreviewByPath] = useState<Record<string, string>>({})
  const [previewLoadingByPath, setPreviewLoadingByPath] = useState<Record<string, boolean>>({})
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const [expandedPdfUrl, setExpandedPdfUrl] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameInline, setRenameInline] = useState<RenameInlineState | null>(null)
  const [isMovingPaths, setIsMovingPaths] = useState(false)
  const previewByPathRef = useRef<Record<string, string>>({})
  const previewLoadingByPathRef = useRef<Record<string, boolean>>({})
  const rootPathRef = useRef('')
  const selectedPathsRef = useRef<string[]>([])
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const renameStartedForPathRef = useRef<string | null>(null)
  const isResizingSidebarRef = useRef(false)
  const [explorerWidth, setExplorerWidth] = useState(320)

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

  useEffect(() => {
    if (!expandedPreviewPath) return

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedPreviewPath(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expandedPreviewPath])

  useEffect(() => {
    const handlePointerMove = (event: globalThis.MouseEvent) => {
      if (!isResizingSidebarRef.current) return
      const nextWidth = Math.min(520, Math.max(280, event.clientX))
      setExplorerWidth(nextWidth)
    }

    const handlePointerUp = () => {
      isResizingSidebarRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)

    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [])

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
      name: t('organizer.defaults.newFolderName'),
    })

    await refreshTreeFromPaths([createdPath])
    setRenameInline({
      path: createdPath,
      value: t('organizer.defaults.newFolderName'),
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
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleFolderDrop = async (event: DragEvent<HTMLDivElement>, folderPath: string) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOverFolderPath(null)

    const internalPayload = event.dataTransfer.getData(INTERNAL_APP_DRAG_TYPE)
    if (!internalPayload || isMovingPaths) return

    try {
      const sourcePaths = [...new Set(JSON.parse(internalPayload) as string[])]
        .filter((item) => item && item !== folderPath && getParentPath(item) !== folderPath)

      if (sourcePaths.length === 0) return

      setIsMovingPaths(true)
      const movedPaths = await toolkit.organizer.movePaths({
        sourcePaths,
        destinationDir: folderPath,
      })

      await refreshTreeFromPaths([...sourcePaths, ...movedPaths, folderPath])
      setExplorerSelectedPaths(movedPaths)
      const movedBySource = new Map(sourcePaths.map((sourcePath, index) => [sourcePath, movedPaths[index] ?? sourcePath]))
      setSelectedPaths(selectedPathsRef.current.map((item) => movedBySource.get(item) ?? item))
      setPreviewByPath((previous) => {
        const next = { ...previous }
        sourcePaths.forEach((sourcePath, index) => {
          const movedPath = movedPaths[index]
          if (!movedPath || !next[sourcePath]) return
          next[movedPath] = next[sourcePath]
          delete next[sourcePath]
        })
        return next
      })
      setPreviewLoadingByPath((previous) => {
        const next = { ...previous }
        sourcePaths.forEach((sourcePath, index) => {
          const movedPath = movedPaths[index]
          if (!movedPath || !next[sourcePath]) return
          next[movedPath] = next[sourcePath]
          delete next[sourcePath]
        })
        return next
      })
      setExpandedPreviewPath((previous) => {
        if (!previous) return previous
        const movedBySource = new Map(sourcePaths.map((sourcePath, index) => [sourcePath, movedPaths[index] ?? sourcePath]))
        return movedBySource.get(previous) ?? previous
      })
    } finally {
      setIsMovingPaths(false)
    }
  }

  const handleExplorerKeyDown = (event: KeyboardEvent<HTMLDivElement>, node: ExplorerNode) => {
    if (node.type === 'folder') return
    if (renameInline?.path === node.path) return

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      startInlineRename(node)
    }
  }

  const handleSelectedItemDragStart = (event: DragEvent<HTMLElement>, targetPath: string) => {
    setDraggedPath(targetPath)
    event.dataTransfer.setData(INTERNAL_APP_DRAG_TYPE, JSON.stringify([targetPath]))
    event.dataTransfer.setData('text/plain', targetPath)
    event.dataTransfer.effectAllowed = 'move'
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
          ? await toolkit.getPdfPreview(targetPath)
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
        name: `${t('organizer.workspaceJobName')} ${new Date().toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}`,
        operation,
        paths: selectedPaths,
        renamePattern,
      })
    } finally {
      setIsStarting(false)
    }
  }

  const expandedPreviewSrc = expandedPreviewPath ? previewByPath[expandedPreviewPath] : null
  const expandedPreviewIsPdf = expandedPreviewPath ? isPdfPath(expandedPreviewPath) : false

  const renderTree = (targetPath: string, depth: number) => {
    const nodes = treeByPath[targetPath] || []

    return nodes.map((node) => {
      const isFolder = node.type === 'folder'
      const isExpanded = isFolder ? expandedPaths.has(node.path) : false
      const isExplorerSelected = explorerSelectedPaths.includes(node.path)
      const isAdded = selectedPaths.includes(node.path)
      const isRenaming = renameInline?.path === node.path
      const isFolderDropTarget = isFolder && dragOverFolderPath === node.path
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
            onDragOver={(event) => {
              if (!isFolder) return
              const dragTypes = Array.from(event.dataTransfer.types || [])
              if (!dragTypes.includes(INTERNAL_APP_DRAG_TYPE)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dragOverFolderPath !== node.path) setDragOverFolderPath(node.path)
            }}
            onDragLeave={() => {
              if (!isFolder) return
              if (dragOverFolderPath === node.path) setDragOverFolderPath(null)
            }}
            onDrop={(event) => {
              if (!isFolder) return
              void handleFolderDrop(event, node.path)
            }}
            className={[
              'flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-[13px] transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-cyan-500/50',
              isFolderDropTarget && 'border-emerald-500/40 bg-emerald-500/10 ring-2 ring-emerald-500/30',
              isExplorerSelected
                ? 'border-cyan-500/30 bg-cyan-500/10 text-white'
                : 'border-transparent text-[var(--text)]',
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
                className={[
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                  isExpanded
                    ? 'border-blue-500/25 bg-blue-500/10 text-blue-300'
                    : 'border-transparent text-zinc-500 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200',
                ].join(' ')}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleFolder(node.path)
                }}
                aria-label={isExpanded ? t('organizer.collapseFolder') : t('organizer.expandFolder')}
              >
                <ChevronRight
                  size={14}
                  className={isExpanded ? 'rotate-90 transition-transform duration-150' : 'transition-transform duration-150'}
                  strokeWidth={2.4}
                />
              </button>
            ) : (
              <span className='h-6 w-6 shrink-0' />
            )}

            <span className={[
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border shadow-sm',
              isFolder
                ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-400'
                : isPdfPath(node.path)
                  ? 'border-rose-500/20 bg-rose-500/10 text-rose-400'
                  : isImagePath(node.path)
                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-500/20 bg-slate-500/10 text-slate-400',
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
                  className='w-full rounded-md border border-cyan-500/30 bg-black/40 px-1.5 py-0.5 text-[13px] text-white outline-none ring-1 ring-cyan-500/50'
                />
              ) : (
                node.name
              )}
            </div>

            {isAdded && (
              <span className='rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700'>
                {t('organizer.inList')}
              </span>
            )}

            {isFolderDropTarget && (
              <span className='rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300'>
                {t('organizer.moveHere')}
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
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className='flex h-full w-full bg-[#09090b]'
    >
      {/* Sidebar: File Explorer */}
      <div
        className='relative flex-shrink-0 border-r border-[#27272a] bg-[#18181b] flex flex-col z-10 shadow-[4px_0_24px_rgba(0,0,0,0.2)]'
        style={{ width: `${explorerWidth}px` }}
      >
        <div className='h-14 flex-shrink-0 border-b border-[#27272a] flex items-center justify-between px-4'>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={toggleSidebar}
              className={[
                'flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                isSidebarOpen
                  ? 'border-blue-500/30 bg-blue-500/10 text-blue-400'
                  : 'border-[#27272a] text-zinc-500 hover:border-zinc-600 hover:text-zinc-200',
              ].join(' ')}
              title={isSidebarOpen ? t('organizer.hideSidebar') : t('organizer.showSidebar')}
            >
              <PanelLeft size={16} />
            </button>
            <span className='text-xs font-semibold text-zinc-300 uppercase tracking-widest'>{t('organizer.explorer')}</span>
          </div>
          <div className='flex gap-1'>
            <button onClick={async () => {
              const folder = await toolkit.organizer.pickFolder()
              if (!folder) return
              await loadTree(folder)
              setSelectedPaths([])
            }} className='p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#27272a] rounded-md transition-colors' title={t('organizer.actions.pickRoot')}>
              <FolderOpen size={14} />
            </button>
            <button onClick={() => rootPath && loadTree(rootPath)} disabled={!rootPath || isLoadingTree} className='p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#27272a] rounded-md transition-colors disabled:opacity-50' title={t('organizer.actions.refresh')}>
              <RefreshCw size={14} className={isLoadingTree ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        
        <div className='flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-2'>
          {isLoadingTree && !treeByPath[rootPath] && (
            <div className='flex items-center justify-center h-20 space-x-2 text-zinc-500'>
              <RefreshCw size={14} className='animate-spin' />
              <span className='text-xs'>{t('common.loading')}</span>
            </div>
          )}
          {rootPath && treeByPath[rootPath] ? (
            <div className='space-y-0.5'>{renderTree(rootPath, 0)}</div>
          ) : (
            !isLoadingTree && <p className='text-xs text-zinc-600 text-center mt-6'>{t('organizer.emptyEntries')}</p>
          )}
        </div>
        
        {/* Bottom Actions for Explorer */}
        <div className='p-3 border-t border-[#27272a] bg-[#18181b] flex-shrink-0'>
           <button
             className='w-full py-2 bg-[#27272a] text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-md text-xs font-medium transition-colors disabled:opacity-50'
             onClick={addExplorerSelection}
             disabled={explorerSelectedPaths.length === 0}
           >
             {t('organizer.actions.addSelected')} ({explorerSelectedPaths.length})
           </button>
        </div>

        <button
          type='button'
          aria-label='Resize file explorer'
          className='absolute inset-y-0 right-[-5px] z-20 w-[10px] cursor-col-resize border-0 bg-transparent group'
          onMouseDown={() => {
            isResizingSidebarRef.current = true
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
        >
          <span className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-cyan-500/50' />
        </button>
      </div>

      {/* Main Content Area */}
      <div className='flex-1 flex flex-col min-w-0 bg-[#09090b] relative'>
        
        {/* Top Bar */}
        <header className='h-14 flex-shrink-0 flex items-center px-6 border-b border-[#27272a] bg-[#09090b]/80 backdrop-blur-sm z-10 sticky top-0'>
          <div className='flex items-center gap-3'>
            <h2 className='text-sm font-semibold text-zinc-100'>{t('organizer.title')}</h2>
            <span className='px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-medium tracking-wider uppercase border border-blue-500/20'>{t('common.beta')}</span>
          </div>
        </header>

        {/* Scrollable Body */}
        <div className='flex-1 overflow-auto custom-scrollbar p-8'>
          <div className='max-w-5xl mx-auto space-y-10 pb-12'>
            <div className='rounded-2xl border border-[#27272a] bg-[#101014] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)]'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <div>
                  <h3 className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('common.operation')}</h3>
                  <p className='mt-1 text-xs text-zinc-600'>{t('organizer.operationHint')}</p>
                </div>
                <button onClick={pickPaths} className='rounded-md border border-[#27272a] px-3 py-2 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white'>
                  {t('dashboard.selectButton')}
                </button>
              </div>

              <div className='grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_1fr]'>
                <div className='space-y-2'>
                  <label htmlFor='workspace-operation' className='text-[10px] font-semibold text-zinc-500 uppercase tracking-widest'>{t('common.operation')}</label>
                  <Select value={operation} onValueChange={(value) => setOperation(value as OperationId)}>
                    <SelectTrigger id='workspace-operation' className='h-[42px] rounded-lg border-[#27272a] bg-[#18181b] px-3 text-zinc-100 hover:border-zinc-700 focus:border-blue-500 focus:ring-blue-500'>
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
                    <label htmlFor='workspace-pattern' className='text-[10px] font-semibold text-zinc-500 uppercase tracking-widest'>
                      {operation === 'batch_rename' ? t('dashboard.renamePattern') : t('dashboard.outputPattern')}
                    </label>
                    <input
                      id='workspace-pattern'
                      className='w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2.5 text-sm text-zinc-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors outline-none shadow-sm placeholder:text-zinc-600'
                      value={renamePattern}
                      onChange={(event) => setRenamePattern(event.target.value)}
                      placeholder='{name}_{seq}'
                    />
                    <p className='text-[10px] text-zinc-500'>{t('dashboard.tokens')} <code className='ml-1 rounded bg-blue-500/10 px-1 py-0.5 text-blue-400'>{"{name}"}</code> <code className='rounded bg-blue-500/10 px-1 py-0.5 text-blue-400'>{"{seq}"}</code> <code className='rounded bg-blue-500/10 px-1 py-0.5 text-blue-400'>{"{date}"}</code></p>
                  </div>
                )}
              </div>
            </div>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                'rounded-2xl border transition-colors',
                isDragActive ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_0_1px_rgba(59,130,246,0.25)]' : 'border-[#27272a] bg-[#0d0d10]',
              ].join(' ')}
            >
              <div className='flex items-center justify-between gap-4 border-b border-[#27272a] px-5 py-4'>
                <div className='min-w-0'>
                  <h3 className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>
                    {t('dashboard.selectedFiles')} <span className='ml-1.5 rounded bg-[#27272a] px-1.5 py-0.5 font-mono text-zinc-300'>{selectedPaths.length}</span>
                  </h3>
                  <p className='mt-1 text-xs text-zinc-600'>
                    {selectedPaths.length === 0
                      ? t('dashboard.dropSubtitle')
                      : t('organizer.selectionHint')}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {selectedPaths.length > 0 && (
                    <button
                      onClick={() => setSelectedPaths([])}
                      className='rounded-md border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-[11px] font-medium text-rose-300 transition-colors hover:border-rose-400/35 hover:bg-rose-500/12 hover:text-rose-200'
                    >
                      {t('organizer.actions.clearAll')}
                    </button>
                  )}
                  <button
                    onClick={runJob}
                    disabled={selectedPaths.length === 0 || isStarting}
                    className='flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-blue-500 disabled:opacity-50'
                  >
                    <Play size={14} />
                    {isStarting ? t('dashboard.starting') : t('organizer.actions.runHere')}
                  </button>
                </div>
              </div>

              <div className='p-5'>
                <div className='mb-5 space-y-3'>
                  <div className='flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500'>
                    <div className='h-1.5 w-1.5 rounded-full bg-blue-500 animate-[pulse_2s_ease-in-out_infinite]' />
                    {t('dashboard.liveProgress')}
                  </div>
                  {activeJobs.length === 0 ? null : (
                    <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
                      <AnimatePresence>
                        {activeJobs.map((job) => (
                          <motion.div key={job.id} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} className='rounded-lg border border-[#27272a] bg-[#18181b] p-3 shadow-sm'>
                            <div className='mb-1.5 flex items-center justify-between'>
                              <p className='truncate pr-2 text-xs font-semibold text-zinc-100'>{job.name}</p>
                              <span className='flex-shrink-0 rounded border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400'>{t(`status.${job.status}`)}</span>
                            </div>
                            <p className='mb-2.5 truncate text-[10px] font-medium text-zinc-500'>{t(operationKeyFromId(job.operation))}</p>
                            <div className='relative h-[3px] w-full overflow-hidden rounded-full bg-[#09090b]'>
                              <motion.div
                                className='absolute inset-y-0 left-0 rounded-full bg-blue-500'
                                initial={{ width: 0 }}
                                animate={{ width: `${job.progress}%` }}
                                transition={{ ease: 'easeOut', duration: 0.5 }}
                              />
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>

                {selectedPaths.length === 0 ? (
                  <div className={[
                    'flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed text-center shadow-inner transition-colors',
                    isDragActive ? 'border-blue-500/60 bg-blue-500/5' : 'border-[#27272a] bg-[#09090b]',
                  ].join(' ')}>
                    <div className='mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[#27272a] bg-[#18181b] text-zinc-400 shadow-sm'>
                      <FileText size={20} />
                    </div>
                    <p className='text-sm font-medium text-zinc-200'>{t('dashboard.dropTitle')}</p>
                    <p className='mt-1.5 text-xs text-zinc-500'>{t('dashboard.dropSubtitle')}</p>
                  </div>
                ) : (
                  <div className='space-y-4'>
                    <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
                      <AnimatePresence>
                        {selectedPaths.map((path) => (
                          <motion.div
                            key={path} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.15 }}
                            draggable
                            onDragStart={(event) => handleSelectedItemDragStart(event as unknown as DragEvent<HTMLDivElement>, path)}
                            onDragEnd={() => { setDraggedPath(null); setDragOverPath(null); }}
                            onDragOver={(event) => event.preventDefault()}
                            onDragEnter={() => setDragOverPath(path)}
                            onDrop={() => handleItemDrop(path)}
                            className={[
                              'group flex h-[90px] overflow-hidden rounded-lg border bg-[#18181b] shadow-sm transition-all',
                              dragOverPath === path ? 'border-blue-500 ring-1 ring-blue-500' : 'border-[#27272a] hover:border-zinc-600 hover:bg-[#202024]',
                            ].join(' ')}
                          >
                            <div className='relative flex w-[100px] shrink-0 items-center justify-center overflow-hidden border-r border-[#27272a] bg-[#09090b]'>
                              {(isImagePath(path) || isPdfPath(path)) ? (
                                previewByPath[path] ? (
                                  <button className='h-full w-full' onClick={() => setExpandedPreviewPath(path)} title={t('dashboard.openExpanded')}>
                                    <img src={previewByPath[path]} alt={t('organizer.previewAlt')} className='h-full w-full object-cover transition-transform group-hover:scale-105 opacity-90 group-hover:opacity-100' />
                                  </button>
                                ) : (
                                  <button onClick={() => loadPreview(path)} className='flex h-full w-full flex-col items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-zinc-600 transition-colors hover:bg-[#27272a] hover:text-zinc-300'>
                                    {previewLoadingByPath[path] ? <RefreshCw size={14} className='animate-spin text-zinc-500' /> : isPdfPath(path) ? <FileText size={16} /> : <FileImage size={16} />}
                                    <span>{previewLoadingByPath[path] ? '' : isPdfPath(path) ? t('organizer.loadPdf') : t('organizer.loadImage')}</span>
                                  </button>
                                )
                              ) : (
                                <div className='flex flex-col items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-700'>
                                  <File size={16} />
                                  <span>{getFileExtension(path) || 'FILE'}</span>
                                </div>
                              )}
                            </div>
                            <div className='relative flex min-w-0 flex-1 flex-col justify-center bg-[#121214] p-3 transition-colors group-hover:bg-[#18181b]'>
                              <button onClick={() => removeItem(path)} className='absolute right-2 top-2 rounded p-1 text-zinc-600 opacity-0 transition-colors hover:bg-[#27272a] hover:text-zinc-300 group-hover:opacity-100'>
                                <X size={14} />
                              </button>
                              <p className='truncate pr-6 text-[13px] font-semibold text-zinc-200'>{getFileName(path)}</p>
                              <p className='mt-1 truncate font-mono text-[10px] leading-relaxed tracking-tight text-zinc-500'>{path}</p>
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className='space-y-3 lg:pt-0'>
                  <AnimatePresence>
                    {lastOutputPath && (
                      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className='rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-sm'>
                        <p className='text-[10px] font-semibold text-emerald-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5'>
                           <RefreshCw size={12} /> {t('dashboard.lastOutput')}
                        </p>
                        <p className='break-all text-[11px] text-emerald-200/80 font-mono mb-3 leading-relaxed'>{lastOutputPath}</p>
                        <button onClick={() => toolkit?.revealInFolder?.(lastOutputPath)} className='text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors uppercase tracking-widest'>
                          {t('dashboard.openInFinder')} &rarr;
                        </button>
                      </motion.div>
                    )}

                    {lastError && (
                      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className='rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 shadow-sm relative'>
                        <button onClick={() => setLastError(null)} className='absolute top-3 right-3 text-rose-500 hover:text-rose-400'>
                          <X size={14} />
                        </button>
                        <p className='text-[10px] font-semibold text-rose-500 uppercase tracking-widest mb-1.5'>{t('dashboard.processingError')}</p>
                        <p className='text-xs font-medium text-rose-200/90 mb-3 mr-6 leading-relaxed'>{lastError.message}</p>
                        <pre className='max-h-24 overflow-auto rounded-md bg-[#09090b] p-2.5 text-[10px] text-rose-400/80 custom-scrollbar border border-rose-500/10 leading-relaxed'>{lastError.detail}</pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
            </div>

          </div>
        </div>
      </div>

      {expandedPreviewPath && expandedPreviewSrc && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6'
          onClick={() => setExpandedPreviewPath(null)}
        >
          <div
            className='flex max-h-[90vh] max-w-[90vw] flex-col overflow-hidden rounded-2xl border border-white/20 bg-black p-3'
            onClick={(event) => event.stopPropagation()}
          >
            <div className='mb-2 flex items-center justify-between gap-3 text-sm text-white'>
              <p className='truncate'>{getFileName(expandedPreviewPath)}</p>
              <Button variant='secondary' onClick={() => setExpandedPreviewPath(null)}>
                {t('common.close')}
              </Button>
            </div>
            <div className={[
              'flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl',
              expandedPreviewIsPdf ? 'bg-[#111827] p-6' : 'bg-black/40 p-3',
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
                  className='max-h-[82vh] max-w-[88vw] object-contain'
                />
              )}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}
            className='fixed z-50 min-w-[220px] rounded-xl border border-white/10 bg-zinc-900/90 p-1.5 shadow-2xl backdrop-blur-md'
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type='button'
              className='flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/10'
              onClick={() => {
                startInlineRename(contextMenu.node)
              }}
            >
              {t('organizer.actions.rename')}
            </button>
            {contextMenu.node.type === 'folder' && (
              <button
                type='button'
                className='flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/10'
                onClick={async () => {
                  const folderNode = contextMenu.node
                  setContextMenu(null)
                  await createSubfolder(folderNode)
                }}
              >
                {t('organizer.actions.newSubfolder')}
              </button>
            )}
            <div className='my-1 h-px bg-white/10' />
            <button
              type='button'
              className='flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/10'
              onClick={() => {
                toolkit.revealInFolder(contextMenu.node.path)
                setContextMenu(null)
              }}
            >
              {t('organizer.actions.showInFolder')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
