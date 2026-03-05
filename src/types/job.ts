export type JobStatus = 'idle' | 'running' | 'success' | 'error'

export type JobRecord = {
  id: string
  name: string
  operation: string
  totalFiles: number
  progress: number
  status: JobStatus
  createdAt: string
}
