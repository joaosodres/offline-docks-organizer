/// <reference types="vite/client" />

import type { AppStateSnapshot, JobRecord } from '@/types/job'
import type { JobPreset } from '@/types/preset'
import type { AppSettings } from '@/types/settings'

declare global {
  interface Window {
    // expose in the `electron/preload/index.ts`
    ipcRenderer: import('electron').IpcRenderer
    toolkit: {
      pickPaths: () => Promise<string[]>
      startJob: (payload: {
        name: string
        operation: string
        paths: string[]
        renamePattern?: string
        dryRun?: boolean
      }) => Promise<JobRecord>
      cancelJob: (jobId: string) => Promise<boolean>
      getPathForFile: (file: File) => string
      getImagePreview: (targetPath: string) => Promise<string | null>
      getPdfPreview: (targetPath: string) => Promise<string | null>
      getPdfBuffer: (targetPath: string) => Promise<Uint8Array | null>
      revealInFolder: (targetPath: string) => Promise<void>
      startNativeDrag: (paths: string[]) => void
      onJobProgress: (listener: (payload: JobRecord) => void) => () => void
      onJobResult: (
        listener: (payload: { job: JobRecord; paths?: string[] }) => void
      ) => () => void
      onJobError: (
        listener: (payload: { job: JobRecord; message: string; detail: string; at: string }) => void
      ) => () => void
      app: {
        getState: () => Promise<AppStateSnapshot>
        saveSettings: (settings: AppSettings) => Promise<boolean>
        saveJobs: (jobs: JobRecord[]) => Promise<boolean>
        savePresets: (presets: JobPreset[]) => Promise<boolean>
      }
      organizer: {
        getHome: () => Promise<string>
        pickFolder: () => Promise<string | null>
        list: (targetPath: string) => Promise<{
          currentPath: string
          parentPath: string | null
          folders: Array<{ name: string; path: string; type: 'folder' }>
          files: Array<{ name: string; path: string; type: 'file' }>
        }>
        createFolder: (payload: { parentPath: string; name: string }) => Promise<string>
        renamePath: (payload: { targetPath: string; newName: string }) => Promise<string>
        movePaths: (payload: { sourcePaths: string[]; destinationDir: string }) => Promise<string[]>
        deletePaths: (payload: { paths: string[] }) => Promise<boolean>
      }
    }
  }
}

export {}
