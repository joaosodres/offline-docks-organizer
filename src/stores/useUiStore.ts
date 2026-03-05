import { create } from 'zustand'

type UiState = {
  isProcessing: boolean
  lastOutputPath: string | null
  lastError: { operation: string; message: string; detail: string; at: string } | null
  setProcessing: (value: boolean) => void
  setLastOutputPath: (value: string | null) => void
  setLastError: (value: { operation: string; message: string; detail: string; at: string } | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  isProcessing: false,
  lastOutputPath: null,
  lastError: null,
  setProcessing: (value) => set({ isProcessing: value }),
  setLastOutputPath: (value) => set({ lastOutputPath: value }),
  setLastError: (value) => set({ lastError: value }),
}))
