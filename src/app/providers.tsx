import { PropsWithChildren, useEffect } from 'react'
import { useJobStore } from '@/stores/useJobStore'
import { useUiStore } from '@/stores/useUiStore'

export function AppProviders({ children }: PropsWithChildren) {
  const upsertJob = useJobStore((state) => state.upsertJob)
  const setLastOutputPath = useUiStore((state) => state.setLastOutputPath)
  const setLastError = useUiStore((state) => state.setLastError)

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
      setLastOutputPath(payload.outputPath)
    })

    return () => unsubscribe()
  }, [setLastOutputPath])

  useEffect(() => {
    if (!window.toolkit?.onJobError) return

    const unsubscribe = window.toolkit.onJobError((payload) => {
      setLastError({
        operation: payload.operation,
        message: payload.message,
        detail: payload.detail,
        at: payload.at,
      })
    })

    return () => unsubscribe()
  }, [setLastError])

  return children
}
