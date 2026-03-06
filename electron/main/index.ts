import { app, BrowserWindow, shell, ipcMain, dialog, nativeImage } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { translations, type SupportedLanguage } from '../../src/i18n/translations'
import type { AppStateSnapshot, JobError, JobRecord, JobStatus } from '../../src/types/job'
import type { JobPreset } from '../../src/types/preset'
import { defaultSettings, type AppSettings } from '../../src/types/settings'

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
const jobCancellation = new Map<string, { cancelled: boolean }>()
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
const defaultAppState: AppStateSnapshot = {
  settings: defaultSettings,
  jobs: [],
  presets: [],
}
let appStateCache: AppStateSnapshot = defaultAppState
const JOB_CANCELLED_CODE = 'JOB_CANCELLED'

function getAppStatePath() {
  return path.join(app.getPath('userData'), 'offline-docs-state.json')
}

function normalizeStoredJob(job: Partial<JobRecord>): JobRecord | null {
  if (!job.id || !job.name || !job.operation || !job.createdAt) return null

  return {
    id: job.id,
    name: job.name,
    operation: job.operation,
    totalFiles: typeof job.totalFiles === 'number' ? job.totalFiles : Array.isArray(job.inputPaths) ? job.inputPaths.length : 0,
    progress: typeof job.progress === 'number' ? job.progress : 0,
    status: (job.status as JobStatus) ?? 'idle',
    createdAt: job.createdAt,
    completedAt: job.completedAt ?? null,
    inputPaths: Array.isArray(job.inputPaths) ? job.inputPaths : [],
    outputPath: job.outputPath ?? null,
    outputPaths: Array.isArray(job.outputPaths) ? job.outputPaths : job.outputPath ? [job.outputPath] : [],
    renamePattern: typeof job.renamePattern === 'string' ? job.renamePattern : undefined,
    dryRun: Boolean(job.dryRun),
    error: job.error ?? null,
  }
}

function getMainLanguage(): SupportedLanguage {
  const locale = app.getLocale()
  if (locale.startsWith('pt')) return 'pt-BR'
  if (locale.startsWith('es')) return 'es'
  return 'en'
}

function getByPath(source: unknown, pathKey: string): string | undefined {
  const result = pathKey
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source)
  return typeof result === 'string' ? result : undefined
}

function tm(key: string) {
  const language = getMainLanguage()
  return getByPath(translations[language] ?? translations.en, key) ?? key
}

async function loadAppState() {
  try {
    const raw = await readFile(getAppStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppStateSnapshot>
    appStateCache = {
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs.map((job) => normalizeStoredJob(job)).filter((job): job is JobRecord => Boolean(job)) : [],
      presets: Array.isArray(parsed.presets)
        ? parsed.presets.filter((preset): preset is JobPreset => Boolean(preset?.id && preset?.name))
        : [],
    }
  } catch {
    appStateCache = defaultAppState
  }

  return appStateCache
}

async function saveAppState(nextState: AppStateSnapshot) {
  appStateCache = nextState
  const appStatePath = getAppStatePath()
  await mkdir(path.dirname(appStatePath), { recursive: true })
  await writeFile(appStatePath, JSON.stringify(nextState, null, 2), 'utf8')
}

async function updateAppState(partial: Partial<AppStateSnapshot>) {
  await saveAppState({
    ...appStateCache,
    ...partial,
  })
}

function mergeJob(existing: JobRecord | undefined, next: JobRecord): JobRecord {
  return {
    ...(existing ?? {}),
    ...next,
    outputPaths: next.outputPaths ?? existing?.outputPaths ?? [],
    error: next.error ?? existing?.error ?? null,
    completedAt: next.completedAt ?? existing?.completedAt ?? null,
    outputPath: next.outputPath ?? existing?.outputPath ?? null,
  }
}

async function persistJob(nextJob: JobRecord) {
  const nextJobs = [...appStateCache.jobs]
  const index = nextJobs.findIndex((job) => job.id === nextJob.id)
  if (index === -1) nextJobs.unshift(nextJob)
  else nextJobs[index] = mergeJob(nextJobs[index], nextJob)
  await updateAppState({ jobs: nextJobs })
  return index === -1 ? nextJob : nextJobs[index]
}

function getStoredJob(jobId: string) {
  return appStateCache.jobs.find((job) => job.id === jobId)
}

function createJobRecord(input: {
  id: string
  name: string
  operation: string
  createdAt: string
  totalFiles: number
  inputPaths: string[]
  renamePattern?: string
  dryRun?: boolean
  status?: JobStatus
  progress?: number
}): JobRecord {
  return {
    id: input.id,
    name: input.name,
    operation: input.operation,
    totalFiles: input.totalFiles,
    progress: input.progress ?? 0,
    status: input.status ?? 'running',
    createdAt: input.createdAt,
    completedAt: null,
    inputPaths: input.inputPaths,
    outputPath: null,
    outputPaths: [],
    renamePattern: input.renamePattern,
    dryRun: input.dryRun ?? false,
    error: null,
  }
}

async function pushJobProgress(nextJob: JobRecord) {
  const persistedJob = await persistJob(nextJob)
  win?.webContents.send('toolkit:job-progress', persistedJob)
  return persistedJob
}

async function pushJobResult(nextJob: JobRecord, paths?: string[]) {
  const persistedJob = await persistJob(nextJob)
  win?.webContents.send('toolkit:job-result', { job: persistedJob, paths })
  return persistedJob
}

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

async function rasterizeImageToPng(imagePath: string, bytes: Buffer) {
  const ext = path.extname(imagePath).replace('.', '').toLowerCase()
  const mimeType = mimeByExtension[ext]
  if (!mimeType) {
    throw new Error(`${tm('organizer.errors.unsupportedImageForPdf')} ${path.basename(imagePath)}`)
  }

  const dataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
  const directImage = nativeImage.createFromDataURL(dataUrl)
  if (!directImage.isEmpty()) return directImage.toPNG()

  const rasterWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  })

  try {
    await rasterWindow.loadURL('data:text/html,<html><body style="margin:0;background:transparent"></body></html>')
    const rasterizedDataUrl = await rasterWindow.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || img.width
          canvas.height = img.naturalHeight || img.height
          const context = canvas.getContext('2d')
          if (!context) {
            reject(new Error(${JSON.stringify(tm('common.unknownError'))}))
            return
          }
          context.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png'))
        }
        img.onerror = () => reject(new Error(${JSON.stringify(tm('common.unknownError'))}))
        img.src = ${JSON.stringify(dataUrl)}
      })
    `, true) as string

    const rasterizedImage = nativeImage.createFromDataURL(rasterizedDataUrl)
    if (rasterizedImage.isEmpty()) {
      throw new Error(`${tm('organizer.errors.couldNotRasterizeImage')} ${path.basename(imagePath)}`)
    }

    return rasterizedImage.toPNG()
  } finally {
    rasterWindow.destroy()
  }
}

async function embedImageForPdf(pdf: PDFDocument, imagePath: string) {
  const ext = path.extname(imagePath).replace('.', '').toLowerCase()
  const bytes = await readFile(imagePath)

  if (ext === 'png') return pdf.embedPng(bytes)
  if (ext === 'jpg' || ext === 'jpeg') return pdf.embedJpg(bytes)

  const rasterizedPng = await rasterizeImageToPng(imagePath, bytes)
  return pdf.embedPng(rasterizedPng)
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

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message || tm('common.unknownError'),
      detail: error.stack || error.message || tm('common.noStack'),
    }
  }
  return {
    message: String(error || tm('common.unknownError')),
    detail: String(error || tm('common.unknownError')),
  }
}

function isCancelledError(error: unknown) {
  return error instanceof Error && error.message === JOB_CANCELLED_CODE
}

function throwIfCancelled(jobId: string) {
  if (jobCancellation.get(jobId)?.cancelled) {
    throw new Error(JOB_CANCELLED_CODE)
  }
}

async function emitJobError(job: JobRecord, error: JobError) {
  console.error(`[toolkit][${job.operation}] ${error.message}\n${error.detail}`)
  const persistedJob = await persistJob({ ...job, error })
  win?.webContents.send('toolkit:job-error', {
    job: persistedJob,
    message: error.message,
    detail: error.detail,
    at: error.at,
  })
}

async function failJobWithError(job: JobRecord, error: unknown) {
  if (isCancelledError(error)) {
    const cancelledJob = {
      ...job,
      status: 'cancelled' as const,
      completedAt: new Date().toISOString(),
      error: null,
    }
    await pushJobProgress(cancelledJob)
    return
  }

  const parsed = normalizeError(error)
  const nextJob = {
    ...job,
    progress: 100,
    status: 'error' as const,
    completedAt: new Date().toISOString(),
    error: {
      message: parsed.message,
      detail: parsed.detail,
      at: new Date().toISOString(),
    },
  }
  await pushJobProgress(nextJob)
  await emitJobError(nextJob, nextJob.error)
}

async function runBatchRename(params: {
  id: string
  name: string
  operation: string
  createdAt: string
  paths: string[]
  renamePattern?: string
  dryRun?: boolean
}) {
  const renamePattern = params.renamePattern?.trim() || '{name}_{seq}'
  const targetFiles = await collectFiles(params.paths)
  const totalFiles = targetFiles.length
  const baseJob = createJobRecord({
    id: params.id,
    name: params.name,
    operation: params.operation,
    createdAt: params.createdAt,
    totalFiles,
    inputPaths: params.paths,
    renamePattern,
    dryRun: params.dryRun,
  })

  if (totalFiles === 0) {
    await failJobWithError(baseJob, new Error(tm('common.unknownError')))
    return
  }

  const reservedPaths = new Set<string>()
  const renamedPaths: string[] = []

  for (let index = 0; index < targetFiles.length; index += 1) {
    throwIfCancelled(params.id)
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
      if (!params.dryRun) await rename(sourcePath, nextPath)
    }
    renamedPaths.push(nextPath)

    const progress = Math.round(((index + 1) / totalFiles) * 100)
    const status = index + 1 === totalFiles ? 'success' : 'running'

    await pushJobProgress({
      ...baseJob,
      totalFiles,
      progress,
      status,
      outputPath: renamedPaths[0] ?? null,
      outputPaths: renamedPaths,
      completedAt: status === 'success' ? new Date().toISOString() : null,
    })
  }

  if (renamedPaths.length > 0) {
    await pushJobResult({
      ...baseJob,
      totalFiles,
      progress: 100,
      status: 'success',
      outputPath: renamedPaths[0],
      outputPaths: renamedPaths,
      completedAt: new Date().toISOString(),
    }, renamedPaths)
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
  const baseJob = createJobRecord({
    id: params.id,
    name: params.name,
    operation: params.operation,
    createdAt: params.createdAt,
    totalFiles,
    inputPaths: params.paths,
    renamePattern: params.renamePattern,
  })

  if (totalFiles === 0) {
    await failJobWithError(baseJob, new Error(tm('common.unknownError')))
    return
  }

  const mergedPdf = await PDFDocument.create()
  for (let index = 0; index < pdfFiles.length; index += 1) {
    throwIfCancelled(params.id)
    const sourcePath = pdfFiles[index]
    const sourceBytes = await readFile(sourcePath)
    const sourcePdf = await PDFDocument.load(sourceBytes)
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices())
    copiedPages.forEach((page) => mergedPdf.addPage(page))

    await pushJobProgress({
      ...baseJob,
      totalFiles,
      progress: Math.max(5, Math.round(((index + 1) / totalFiles) * 90)),
      status: 'running',
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

  await pushJobProgress({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
  await pushJobResult({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
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
  const baseJob = createJobRecord({
    id: params.id,
    name: params.name,
    operation: params.operation,
    createdAt: params.createdAt,
    totalFiles,
    inputPaths: params.paths,
  })

  if (totalFiles === 0) {
    await failJobWithError(baseJob, new Error(tm('common.unknownError')))
    return
  }

  let firstOutputPath = ''
  for (let fileIndex = 0; fileIndex < pdfFiles.length; fileIndex += 1) {
    throwIfCancelled(params.id)
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

    await pushJobProgress({
      ...baseJob,
      totalFiles,
      progress: Math.round(((fileIndex + 1) / totalFiles) * 100),
      status: fileIndex + 1 === totalFiles ? 'success' : 'running',
      outputPath: firstOutputPath || null,
      outputPaths: firstOutputPath ? [firstOutputPath] : [],
      completedAt: fileIndex + 1 === totalFiles ? new Date().toISOString() : null,
    })
  }

  const outputPath = firstOutputPath || pdfFiles[0]
  await pushJobResult({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
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
  const baseJob = createJobRecord({
    id: params.id,
    name: params.name,
    operation: params.operation,
    createdAt: params.createdAt,
    totalFiles,
    inputPaths: params.paths,
  })

  if (totalFiles === 0) {
    await failJobWithError(baseJob, new Error(tm('common.unknownError')))
    return
  }

  let firstOutputPath = ''
  for (let index = 0; index < csvFiles.length; index += 1) {
    throwIfCancelled(params.id)
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

    await pushJobProgress({
      ...baseJob,
      totalFiles,
      progress: Math.round(((index + 1) / totalFiles) * 100),
      status: index + 1 === totalFiles ? 'success' : 'running',
      outputPath: firstOutputPath || null,
      outputPaths: firstOutputPath ? [firstOutputPath] : [],
      completedAt: index + 1 === totalFiles ? new Date().toISOString() : null,
    })
  }

  const outputPath = firstOutputPath || csvFiles[0]
  await pushJobResult({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
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
    return ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp'
  })
  const totalFiles = compatibleImages.length
  const baseJob = createJobRecord({
    id: params.id,
    name: params.name,
    operation: params.operation,
    createdAt: params.createdAt,
    totalFiles,
    inputPaths: params.paths,
    renamePattern: params.renamePattern,
  })

  if (totalFiles === 0) {
    await failJobWithError(baseJob, new Error(tm('organizer.errors.noCompatibleImages')))
    return
  }

  const outPdf = await PDFDocument.create()
  for (let index = 0; index < compatibleImages.length; index += 1) {
    throwIfCancelled(params.id)
    const imagePath = compatibleImages[index]
    const image = await embedImageForPdf(outPdf, imagePath)

    const page = outPdf.addPage([image.width, image.height])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    })

    await pushJobProgress({
      ...baseJob,
      totalFiles,
      progress: Math.round(((index + 1) / totalFiles) * 90),
      status: 'running',
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

  await pushJobProgress({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
  await pushJobResult({
    ...baseJob,
    totalFiles,
    progress: 100,
    status: 'success',
    outputPath,
    outputPaths: [outputPath],
    completedAt: new Date().toISOString(),
  })
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

}

app.whenReady().then(async () => {
  await loadAppState()
  await createWindow()
})

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
    title: tm('organizer.dialogs.selectFilesOrFolders'),
  })

  return result.canceled ? [] : result.filePaths
})

ipcMain.handle(
  'toolkit:start-job',
  async (_, payload: { name: string; operation: string; paths: string[]; renamePattern?: string; dryRun?: boolean }) => {
    const jobId = randomUUID()
    const createdAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    jobCancellation.set(jobId, { cancelled: false })

    const initialJob = createJobRecord({
      id: jobId,
      name: payload.name,
      operation: payload.operation,
      createdAt,
      totalFiles: payload.paths.length,
      inputPaths: payload.paths,
      renamePattern: payload.renamePattern,
      dryRun: payload.dryRun,
    })

    await pushJobProgress(initialJob)

    if (payload.operation === 'batch_rename' || payload.operation === 'Batch Rename') {
      runBatchRename({
        id: jobId,
        name: payload.name,
        operation: payload.operation,
        createdAt,
        paths: payload.paths,
        renamePattern: payload.renamePattern,
        dryRun: payload.dryRun,
      }).catch((error) => {
        void failJobWithError(initialJob, error)
      }).finally(() => {
        jobCancellation.delete(jobId)
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
        void failJobWithError(initialJob, error)
      }).finally(() => {
        jobCancellation.delete(jobId)
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
        void failJobWithError(initialJob, error)
      }).finally(() => {
        jobCancellation.delete(jobId)
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
        void failJobWithError(initialJob, error)
      }).finally(() => {
        jobCancellation.delete(jobId)
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
        void failJobWithError(initialJob, error)
      }).finally(() => {
        jobCancellation.delete(jobId)
      })
      return initialJob
    }

    let progress = 0
    const timer = setInterval(() => {
      if (jobCancellation.get(jobId)?.cancelled) {
        clearInterval(timer)
        runningJobs.delete(jobId)
        jobCancellation.delete(jobId)
        void pushJobProgress({
          ...initialJob,
          status: 'cancelled',
          completedAt: new Date().toISOString(),
        })
        return
      }

      const increment = Math.floor(Math.random() * 14) + 7
      progress = Math.min(100, progress + increment)

      void pushJobProgress({
        ...initialJob,
        progress,
        status: progress >= 100 ? 'success' : 'running',
        completedAt: progress >= 100 ? new Date().toISOString() : null,
      })

      if (progress >= 100) {
        void pushJobResult({
          ...initialJob,
          progress: 100,
          status: 'success',
          outputPath: payload.paths[0] || '',
          outputPaths: payload.paths[0] ? [payload.paths[0]] : [],
          completedAt: new Date().toISOString(),
        })
        clearInterval(timer)
        runningJobs.delete(jobId)
        jobCancellation.delete(jobId)
      }
    }, 850)

    runningJobs.set(jobId, timer)

    return initialJob
  },
)

ipcMain.handle('toolkit:cancel-job', async (_, jobId: string) => {
  const controller = jobCancellation.get(jobId)
  if (!controller) return false
  controller.cancelled = true
  return true
})

ipcMain.handle('toolkit:app-get-state', async () => {
  await loadAppState()
  return appStateCache
})

ipcMain.handle('toolkit:app-save-settings', async (_, settings: AppSettings) => {
  await updateAppState({
    settings: { ...defaultSettings, ...settings },
  })
  return true
})

ipcMain.handle('toolkit:app-save-jobs', async (_, jobs: JobRecord[]) => {
  await updateAppState({ jobs })
  return true
})

ipcMain.handle('toolkit:app-save-presets', async (_, presets: JobPreset[]) => {
  await updateAppState({ presets })
  return true
})

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

ipcMain.handle('toolkit:get-pdf-preview', async (_, targetPath: string) => {
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(targetPath, {
      width: 256,
      height: 256,
    })

    return thumbnail.isEmpty() ? null : thumbnail.toDataURL()
  } catch {
    return null
  }
})

ipcMain.handle('toolkit:get-pdf-buffer', async (_, targetPath: string) => {
  try {
    const fileBuffer = await readFile(targetPath)
    return Uint8Array.from(fileBuffer)
  } catch {
    return null
  }
})

ipcMain.handle('toolkit:organizer-get-home', () => os.homedir())

ipcMain.handle('toolkit:organizer-pick-folder', async () => {
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: tm('organizer.dialogs.selectFolder'),
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
  throw new Error(tm('organizer.errors.deleteDisabled'))
})
