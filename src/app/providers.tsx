import { PropsWithChildren, useEffect } from 'react'
import { useJobStore } from '@/stores/useJobStore'
import { usePresetStore } from '@/stores/usePresetStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useUiStore } from '@/stores/useUiStore'

export function AppProviders({ children }: PropsWithChildren) {
  const upsertJob = useJobStore((state) => state.upsertJob)
  const setJobs = useJobStore((state) => state.setJobs)
  const setPresets = usePresetStore((state) => state.setPresets)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const setLastOutputPath = useUiStore((state) => state.setLastOutputPath)
  const setLastError = useUiStore((state) => state.setLastError)

  useEffect(() => {
    let disposed = false
    let unsubscribeSettings = () => {}
    let unsubscribeJobs = () => {}
    let unsubscribePresets = () => {}

    const hydrate = async () => {
      const snapshot = await window.toolkit.app.getState()
      if (disposed) return

      setSettings(snapshot.settings)
      setJobs(snapshot.jobs)
      setPresets(snapshot.presets)

      unsubscribeSettings = useSettingsStore.subscribe((state) => {
        void window.toolkit.app.saveSettings(state.settings)
      })
      unsubscribeJobs = useJobStore.subscribe((state) => {
        void window.toolkit.app.saveJobs(state.jobs)
      })
      unsubscribePresets = usePresetStore.subscribe((state) => {
        void window.toolkit.app.savePresets(state.presets)
      })
    }

    void hydrate()

    return () => {
      disposed = true
      unsubscribeSettings()
      unsubscribeJobs()
      unsubscribePresets()
    }
  }, [setJobs, setPresets, setSettings])

  useEffect(() => {
    if (!window.toolkit?.onJobProgress) return

    const unsubscribe = window.toolkit.onJobProgress((payload) => {
      upsertJob(payload)
    })

    return () => unsubscribe()
  }, [upsertJob])

  useEffect(() => {
    if (!window.toolkit?.onJobResult) return

    const unsubscribe = window.toolkit.onJobResult((payload) => {
      upsertJob(payload.job)
      setLastOutputPath(payload.job.outputPath ?? null)
    })

    return () => unsubscribe()
  }, [setLastOutputPath, upsertJob])

  useEffect(() => {
    if (!window.toolkit?.onJobError) return

    const unsubscribe = window.toolkit.onJobError((payload) => {
      upsertJob(payload.job)
      setLastError({
        operation: payload.job.operation,
        message: payload.message,
        detail: payload.detail,
        at: payload.at,
      })
    })

    return () => unsubscribe()
  }, [setLastError, upsertJob])

  return children
}
