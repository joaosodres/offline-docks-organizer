import { create } from 'zustand'
import { JobRecord } from '@/types/job'

const demoJobs: JobRecord[] = [
  {
    id: 'job_1',
    name: 'Fev invoices merge',
    operation: 'merge_pdf_rename',
    totalFiles: 42,
    progress: 100,
    status: 'success',
    createdAt: '2026-03-04 18:10',
  },
  {
    id: 'job_2',
    name: 'CSV import cleaning',
    operation: 'csv_filter_xlsx_export',
    totalFiles: 18,
    progress: 63,
    status: 'running',
    createdAt: '2026-03-04 18:25',
  },
  {
    id: 'job_3',
    name: 'Legal docs split',
    operation: 'split_pdf',
    totalFiles: 27,
    progress: 0,
    status: 'idle',
    createdAt: '2026-03-04 18:31',
  },
]

type JobState = {
  jobs: JobRecord[]
  setJobs: (jobs: JobRecord[]) => void
  addJob: (job: JobRecord) => void
  upsertJob: (job: JobRecord) => void
}

export const useJobStore = create<JobState>((set) => ({
  jobs: demoJobs,
  setJobs: (jobs) => set({ jobs }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  upsertJob: (job) =>
    set((state) => {
      const index = state.jobs.findIndex((existing) => existing.id === job.id)
      if (index === -1) return { jobs: [job, ...state.jobs] }

      const nextJobs = [...state.jobs]
      nextJobs[index] = { ...nextJobs[index], ...job }
      return { jobs: nextJobs }
    }),
}))
