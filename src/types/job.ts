import type { AppSettings } from '@/types/settings'
import type { JobPreset } from '@/types/preset'

export type JobStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export type JobError = {
  message: string
  detail: string
  at: string
}

export type JobRecord = {
  id: string
  name: string
  operation: string
  totalFiles: number
  progress: number
  status: JobStatus
  createdAt: string
  completedAt?: string | null
  inputPaths: string[]
  outputPath?: string | null
  outputPaths?: string[]
  renamePattern?: string
  dryRun?: boolean
  error?: JobError | null
}

export type AppStateSnapshot = {
  settings: AppSettings
  jobs: JobRecord[]
  presets: JobPreset[]
}
