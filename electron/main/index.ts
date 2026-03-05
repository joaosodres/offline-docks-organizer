import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { update } from './update'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
const runningJobs = new Map<string, NodeJS.Timeout>()
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const mimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}
const supportedOrganizerExtensions = new Set([
  'pdf',
  'csv',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
])

function formatWithPattern(input: { pattern: string; originalName: string; seq: number }) {
  const date = new Date().toISOString().slice(0, 10)
  const seq = String(input.seq).padStart(3, '0')
  return input.pattern
    .replaceAll('{name}', input.originalName)
    .replaceAll('{seq}', seq)
    .replaceAll('{date}', date)
}

async function collectFiles(inputPaths: string[]): Promise<string[]> {
  const files: string[] = []

  async function walk(targetPath: string) {
    const fileStat = await stat(targetPath)
    if (fileStat.isDirectory()) {
      const children = await readdir(targetPath, { withFileTypes: true })
      children.sort((a, b) => a.name.localeCompare(b.name))
      for (const child of children) {
        await walk(path.join(targetPath, child.name))
      }
      return
    }

    if (fileStat.isFile()) files.push(targetPath)
  }

  for (const inputPath of inputPaths) {
    await walk(inputPath)
  }

  return files
}

async function collectFilesByExtension(inputPaths: string[], extensions: string[]) {
  const allFiles = await collectFiles(inputPaths)
  const extensionSet = new Set(extensions.map((value) => value.toLowerCase()))
  return allFiles
    .filter((filePath) => extensionSet.has(path.extname(filePath).replace('.', '').toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
}

async function ensureUniquePath(targetPath: string) {
  let candidate = targetPath
  let suffix = 1
  while (true) {
    try {
      await stat(candidate)
      const parsed = path.parse(targetPath)
      candidate = path.join(parsed.dir, `${parsed.name}_${suffix}${parsed.ext}`)
      suffix += 1
    } catch {
      return candidate
    }
  }
}

async function ensureSafeRenameTarget(targetPath: string, reservedPaths: Set<string>, sourcePath?: string) {
  let candidate = targetPath
  let suffix = 1

  while (true) {
    const reservedConflict = reservedPaths.has(candidate) && candidate !== sourcePath
    if (!reservedConflict) {
      try {
        await stat(candidate)
        if (candidate === sourcePath) return candidate
      } catch {
        return candidate
      }
    }

    const parsed = path.parse(targetPath)
    candidate = path.join(parsed.dir, `${parsed.name}_${suffix}${parsed.ext}`)
    suffix += 1
  }
}

function formatOutputName(base: string, extension: string) {
  const safeBase = base.replace(/[<>:\"/\\|?*]/g, '_')
  return `${safeBase}${extension}`
}

function emitJobProgress(payload: {
  id: string
  name: string
  operation: string
  totalFiles: number
  progress: number
  status: 'idle' | 'running' | 'success' | 'error'
  createdAt: string
}) {
  win?.webContents.send('toolkit:job-progress', payload)
}

function emitJobResult(payload: { id: string; outputPath: string; totalFiles: number; paths?: string[] }) {
  win?.webContents.send('toolkit:job-result', payload)
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      detail: error.stack || error.message || 'No stack available',
    }
  }
  return {
    message: String(error || 'Unknown error'),
    detail: String(error || 'Unknown error'),
  }
}

function emitJobError(payload: {
  id: string
  operation: string
  message: string
  detail: string
  at: string
}) {
  console.error(`[toolkit][${payload.operation}] ${payload.message}\n${payload.detail}`)
  win?.webContents.send('toolkit:job-error', payload)
}

function failJobWithError(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  totalFiles: number
  error: unknown
}) {
  const parsed = normalizeError(params.error)
  emitJobProgress({
    id: params.id,
    name: params.name,
    operation: params.operation,
    totalFiles: params.totalFiles,
    progress: 100,
    status: 'error',
    createdAt: params.createdAt,
  })
  emitJobError({
    id: params.id,
    operation: params.operation,
    message: parsed.message,
    detail: parsed.detail,
    at: new Date().toISOString(),
  })
}

async function runBatchRename(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
  renamePattern?: string
}) {
  const renamePattern = params.renamePattern?.trim() || '{name}_{seq}'
  const targetFiles = await collectFiles(params.paths)
  const totalFiles = targetFiles.length

  if (totalFiles === 0) {
    win?.webContents.send('toolkit:job-progress', {
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles: 0,
      progress: 100,
      status: 'error',
      createdAt: params.createdAt,
    })
    return
  }

  const reservedPaths = new Set<string>()
  const renamedPaths: string[] = []

  for (let index = 0; index < targetFiles.length; index += 1) {
    const sourcePath = targetFiles[index]
    const parsed = path.parse(sourcePath)
    const nextNameBase = formatWithPattern({
      pattern: renamePattern,
      originalName: parsed.name,
      seq: index + 1,
    }).replace(/[<>:\"/\\|?*]/g, '_')

    let nextPath = path.join(parsed.dir, `${nextNameBase}${parsed.ext}`)
    nextPath = await ensureSafeRenameTarget(nextPath, reservedPaths, sourcePath)
    reservedPaths.add(nextPath)

    if (sourcePath !== nextPath) {
      await rename(sourcePath, nextPath)
    }
    renamedPaths.push(nextPath)

    const progress = Math.round(((index + 1) / totalFiles) * 100)
    const status = index + 1 === totalFiles ? 'success' : 'running'

    win?.webContents.send('toolkit:job-progress', {
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles,
      progress,
      status,
      createdAt: params.createdAt,
    })
  }

  if (renamedPaths.length > 0) {
    emitJobResult({
      id: params.id,
      outputPath: renamedPaths[0],
      totalFiles,
      paths: renamedPaths,
    })
  }
}

async function runMergePdfRename(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
  renamePattern?: string
}) {
  const pdfFiles = await collectFilesByExtension(params.paths, ['pdf'])
  const totalFiles = pdfFiles.length

  if (totalFiles === 0) {
    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles: 0,
      progress: 100,
      status: 'error',
      createdAt: params.createdAt,
    })
    return
  }

  const mergedPdf = await PDFDocument.create()
  for (let index = 0; index < pdfFiles.length; index += 1) {
    const sourcePath = pdfFiles[index]
    const sourceBytes = await readFile(sourcePath)
    const sourcePdf = await PDFDocument.load(sourceBytes)
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
    copiedPages.forEach((page) => mergedPdf.addPage(page))

    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles,
      progress: Math.max(5, Math.round(((index + 1) / totalFiles) * 90)),
      status: 'running',
      createdAt: params.createdAt,
    })
  }

  const firstDir = path.dirname(pdfFiles[0])
  const fileBase = formatWithPattern({
    pattern: (params.renamePattern?.trim() || 'merged_{date}'),
    originalName: 'merged',
    seq: 1,
  })
  const outputPath = await ensureUniquePath(path.join(firstDir, formatOutputName(fileBase, '.pdf')))
  const mergedBytes = await mergedPdf.save()
  await writeFile(outputPath, mergedBytes)

  emitJobProgress({
    id: params.id,
    name: params.name,
    operation: params.operation,
    totalFiles,
    progress: 100,
    status: 'success',
    createdAt: params.createdAt,
  })
  emitJobResult({ id: params.id, outputPath, totalFiles })
}

async function runSplitPdf(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
}) {
  const pdfFiles = await collectFilesByExtension(params.paths, ['pdf'])
  const totalFiles = pdfFiles.length

  if (totalFiles === 0) {
    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles: 0,
      progress: 100,
      status: 'error',
      createdAt: params.createdAt,
    })
    return
  }

  let firstOutputPath = ''
  for (let fileIndex = 0; fileIndex < pdfFiles.length; fileIndex += 1) {
    const sourcePath = pdfFiles[fileIndex]
    const parsed = path.parse(sourcePath)
    const sourceBytes = await readFile(sourcePath)
    const sourcePdf = await PDFDocument.load(sourceBytes)
    const pageCount = sourcePdf.getPageCount()

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const onePagePdf = await PDFDocument.create()
      const [copiedPage] = await onePagePdf.copyPages(sourcePdf, [pageIndex])
      onePagePdf.addPage(copiedPage)
      const bytes = await onePagePdf.save()
      const pageSuffix = String(pageIndex + 1).padStart(3, '0')
      const outputPath = await ensureUniquePath(path.join(parsed.dir, `${parsed.name}_p${pageSuffix}.pdf`))
      await writeFile(outputPath, bytes)
      if (!firstOutputPath) firstOutputPath = outputPath
    }

    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles,
      progress: Math.round(((fileIndex + 1) / totalFiles) * 100),
      status: fileIndex + 1 === totalFiles ? 'success' : 'running',
      createdAt: params.createdAt,
    })
  }

  emitJobResult({ id: params.id, outputPath: firstOutputPath || pdfFiles[0], totalFiles })
}

async function runCsvFilterXlsxExport(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
}) {
  const csvFiles = await collectFilesByExtension(params.paths, ['csv'])
  const totalFiles = csvFiles.length

  if (totalFiles === 0) {
    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles: 0,
      progress: 100,
      status: 'error',
      createdAt: params.createdAt,
    })
    return
  }

  let firstOutputPath = ''
  for (let index = 0; index < csvFiles.length; index += 1) {
    const csvPath = csvFiles[index]
    const csvBytes = await readFile(csvPath)
    const workbook = XLSX.read(csvBytes, { type: 'buffer', raw: true, dense: true })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      throw new Error(`CSV sem planilha legível: ${csvPath}`)
    }
    const firstSheet = workbook.Sheets[firstSheetName]
    if (!firstSheet) {
      throw new Error(`Falha ao abrir conteúdo do CSV: ${csvPath}`)
    }
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(firstSheet, { header: 1, defval: null })
    const filteredRows = rows.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
    const outWorkbook = XLSX.utils.book_new()
    const outSheet = XLSX.utils.aoa_to_sheet(filteredRows)
    XLSX.utils.book_append_sheet(outWorkbook, outSheet, 'Data')

    const parsed = path.parse(csvPath)
    const outputPath = await ensureUniquePath(path.join(parsed.dir, `${parsed.name}.xlsx`))
    const xlsxBytes = XLSX.write(outWorkbook, { bookType: 'xlsx', type: 'buffer' })
    await writeFile(outputPath, xlsxBytes)
    if (!firstOutputPath) firstOutputPath = outputPath

    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles,
      progress: Math.round(((index + 1) / totalFiles) * 100),
      status: index + 1 === totalFiles ? 'success' : 'running',
      createdAt: params.createdAt,
    })
  }

  emitJobResult({ id: params.id, outputPath: firstOutputPath || csvFiles[0], totalFiles })
}

async function runImagesToPdf(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
  renamePattern?: string
}) {
  const allFiles = await collectFiles(params.paths)
  const compatibleImages = allFiles.filter((filePath) => {
    const ext = path.extname(filePath).replace('.', '').toLowerCase()
    return ext === 'jpg' || ext === 'jpeg' || ext === 'png'
  })
  const totalFiles = compatibleImages.length

  if (totalFiles === 0) {
    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles: 0,
      progress: 100,
      status: 'error',
      createdAt: params.createdAt,
    })
    throw new Error('Nenhuma imagem compativel encontrada. Use JPG, JPEG ou PNG.')
  }

  const outPdf = await PDFDocument.create()
  for (let index = 0; index < compatibleImages.length; index += 1) {
    const imagePath = compatibleImages[index]
    const ext = path.extname(imagePath).replace('.', '').toLowerCase()
    const bytes = await readFile(imagePath)
    const image = ext === 'png'
      ? await outPdf.embedPng(bytes)
      : await outPdf.embedJpg(bytes)

    const page = outPdf.addPage([image.width, image.height])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    })

    emitJobProgress({
      id: params.id,
      name: params.name,
      operation: params.operation,
      totalFiles,
      progress: Math.round(((index + 1) / totalFiles) * 90),
      status: 'running',
      createdAt: params.createdAt,
    })
  }

  const firstDir = path.dirname(compatibleImages[0])
  const fileBase = formatWithPattern({
    pattern: params.renamePattern?.trim() || 'images_{date}',
    originalName: 'images',
    seq: 1,
  })
  const outputPath = await ensureUniquePath(path.join(firstDir, formatOutputName(fileBase, '.pdf')))
  const pdfBytes = await outPdf.save()
  await writeFile(outputPath, pdfBytes)

  emitJobProgress({
    id: params.id,
    name: params.name,
    operation: params.operation,
    totalFiles,
    progress: 100,
    status: 'success',
    createdAt: params.createdAt,
  })
  emitJobResult({ id: params.id, outputPath, totalFiles })
}

async function createWindow() {
  win = new BrowserWindow({
    title: 'Main window',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Auto update
  update(win)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  for (const timer of runningJobs.values()) clearInterval(timer)
  runningJobs.clear()
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

ipcMain.handle('toolkit:pick-paths', async () => {
  if (!win) return []

  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    title: 'Select files or folders',
  })

  return result.canceled ? [] : result.filePaths
})

ipcMain.handle(
  'toolkit:start-job',
  async (_, payload: { name: string; operation: string; paths: string[]; renamePattern?: string }) => {
    const jobId = randomUUID()
    const createdAt = new Date().toISOString().slice(0, 16).replace('T', ' ')

    const initialJob = {
      id: jobId,
      name: payload.name,
      operation: payload.operation,
      totalFiles: payload.paths.length,
      progress: 0,
      status: 'running' as const,
      createdAt,
    }

    emitJobProgress(initialJob)

    if (payload.operation === 'batch_rename' || payload.operation === 'Batch Rename') {
      runBatchRename({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
        renamePattern: payload.renamePattern,
      }).catch((error) => {
        failJobWithError({
          id: jobId,
          name: payload.name,
          operation: payload.operation,
          createdAt,
          totalFiles: payload.paths.length,
          error,
        })
      })
      return initialJob
    }

    if (payload.operation === 'merge_pdf_rename' || payload.operation === 'Merge PDF + Rename') {
      runMergePdfRename({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
        renamePattern: payload.renamePattern,
      }).catch((error) => {
        failJobWithError({
          id: jobId,
          name: payload.name,
          operation: payload.operation,
          createdAt,
          totalFiles: payload.paths.length,
          error,
        })
      })
      return initialJob
    }

    if (payload.operation === 'split_pdf' || payload.operation === 'Split PDF') {
      runSplitPdf({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
      }).catch((error) => {
        failJobWithError({
          id: jobId,
          name: payload.name,
          operation: payload.operation,
          createdAt,
          totalFiles: payload.paths.length,
          error,
        })
      })
      return initialJob
    }

    if (payload.operation === 'csv_filter_xlsx_export' || payload.operation === 'CSV Filter + XLSX Export') {
      runCsvFilterXlsxExport({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
      }).catch((error) => {
        failJobWithError({
          id: jobId,
          name: payload.name,
          operation: payload.operation,
          createdAt,
          totalFiles: payload.paths.length,
          error,
        })
      })
      return initialJob
    }

    if (payload.operation === 'images_to_pdf' || payload.operation === 'Images to PDF') {
      runImagesToPdf({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
        renamePattern: payload.renamePattern,
      }).catch((error) => {
        failJobWithError({
          id: jobId,
          name: payload.name,
          operation: payload.operation,
          createdAt,
          totalFiles: payload.paths.length,
          error,
        })
      })
      return initialJob
    }

    let progress = 0
    const timer = setInterval(() => {
      const increment = Math.floor(Math.random() * 14) + 7
      progress = Math.min(100, progress + increment)

      emitJobProgress({
        ...initialJob,
        progress,
        status: progress >= 100 ? 'success' : 'running',
      })

      if (progress >= 100) {
        emitJobResult({
          id: jobId,
          outputPath: payload.paths[0] || '',
          totalFiles: payload.paths.length,
        })
        clearInterval(timer)
        runningJobs.delete(jobId)
      }
    }, 850)

    runningJobs.set(jobId, timer)

    return initialJob
  },
)

ipcMain.handle('toolkit:reveal-in-folder', (_, targetPath: string) => {
  if (!targetPath) return
  shell.showItemInFolder(targetPath)
})

ipcMain.on('toolkit:start-native-drag', (_, payload: { paths: string[] }) => {
  if (!win || !payload.paths || payload.paths.length === 0) return

  const iconPath = path.join(process.env.APP_ROOT, 'build', 'icon.png')
  win.webContents.startDrag({
    file: payload.paths[0],
    files: payload.paths,
    icon: iconPath,
  })
})

ipcMain.handle('toolkit:get-image-preview', async (_, targetPath: string) => {
  const extension = path.extname(targetPath).replace('.', '').toLowerCase()
  const mimeType = mimeByExtension[extension]
  if (!mimeType) return null

  try {
    const fileBuffer = await readFile(targetPath)
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`
  } catch {
    return null
  }
})

ipcMain.handle('toolkit:get-pdf-buffer', async (_, targetPath: string) => {
  try {
    const fileBuffer = await readFile(targetPath)
    return fileBuffer.toString('base64')
  } catch {
    return null
  }
})

ipcMain.handle('toolkit:organizer-get-home', () => os.homedir())

ipcMain.handle('toolkit:organizer-pick-folder', async () => {
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select folder',
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('toolkit:organizer-list', async (_, targetPath: string) => {
  const currentPath = targetPath || os.homedir()
  const entries = await readdir(currentPath, { withFileTypes: true })
  const visibleEntries = entries.filter((entry) => !entry.name.startsWith('.'))
  visibleEntries.sort((a, b) => a.name.localeCompare(b.name))

  const folders = visibleEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
      type: 'folder' as const,
    }))

  const files = visibleEntries
    .filter((entry) => {
      if (!entry.isFile()) return false
      const extension = path.extname(entry.name).replace('.', '').toLowerCase()
      return supportedOrganizerExtensions.has(extension)
    })
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
      type: 'file' as const,
    }))

  return {
    currentPath,
    parentPath: path.dirname(currentPath) === currentPath ? null : path.dirname(currentPath),
    folders,
    files,
  }
})

ipcMain.handle('toolkit:organizer-create-folder', async (_, payload: { parentPath: string; name: string }) => {
  const requestedPath = path.join(payload.parentPath, payload.name)
  const targetPath = await ensureUniquePath(requestedPath)
  await mkdir(targetPath, { recursive: true })
  return targetPath
})

ipcMain.handle('toolkit:organizer-rename-path', async (_, payload: { targetPath: string; newName: string }) => {
  const requestedPath = path.join(path.dirname(payload.targetPath), payload.newName)
  const nextPath = await ensureSafeRenameTarget(requestedPath, new Set(), payload.targetPath)
  await rename(payload.targetPath, nextPath)
  return nextPath
})

ipcMain.handle('toolkit:organizer-move-paths', async (_, payload: { sourcePaths: string[]; destinationDir: string }) => {
  const movedPaths: string[] = []
  const reservedPaths = new Set<string>()
  for (const sourcePath of payload.sourcePaths) {
    const requestedPath = path.join(payload.destinationDir, path.basename(sourcePath))
    const destinationPath = await ensureSafeRenameTarget(requestedPath, reservedPaths, sourcePath)
    reservedPaths.add(destinationPath)
    await rename(sourcePath, destinationPath)
    movedPaths.push(destinationPath)
  }
  return movedPaths
})

ipcMain.handle('toolkit:organizer-delete-paths', async (_, payload: { paths: string[] }) => {
  console.warn('[toolkit] delete blocked by safety policy', payload.paths)
  throw new Error('Delete is disabled by safety policy. This app does not remove user files.')
})
