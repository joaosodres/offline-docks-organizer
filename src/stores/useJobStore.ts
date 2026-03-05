import { create } from 'zustand'
import { JobRecord } from '@/types/job'

type JobState = {
  jobs: JobRecord[]
  setJobs: (jobs: JobRecord[]) => void
  addJob: (job: JobRecord) => void
  upsertJob: (job: JobRecord) => void
}

export const useJobStore = create<JobState>((set) => ({
  jobs: [],
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
