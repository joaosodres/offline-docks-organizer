/// <reference types="vite/client" />

import type { JobRecord } from '@/types/job'

declare global {
  interface Window {
    // expose in the `electron/preload/index.ts`
    ipcRenderer: import('electron').IpcRenderer
    toolkit: {
      pickPaths: () => Promise<string[]>
      startJob: (payload: { name: string; operation: string; paths: string[]; renamePattern?: string }) => Promise<JobRecord>
      getPathForFile: (file: File) => string
      getImagePreview: (targetPath: string) => Promise<string | null>
      revealInFolder: (targetPath: string) => Promise<void>
      onJobProgress: (listener: (payload: JobRecord) => void) => () => void
      onJobResult: (listener: (payload: { id: string; outputPath: string; totalFiles: number }) => void) => () => void
      onJobError: (
        listener: (payload: { id: string; operation: string; message: string; detail: string; at: string }) => void
      ) => () => void
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
