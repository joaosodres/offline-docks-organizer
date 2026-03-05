import { create } from 'zustand'

type UiState = {
  isProcessing: boolean
  isSidebarOpen: boolean
  lastOutputPath: string | null
  lastError: { operation: string; message: string; detail: string; at: string } | null
  setProcessing: (value: boolean) => void
  setSidebarOpen: (value: boolean) => void
  toggleSidebar: () => void
  setLastOutputPath: (value: string | null) => void
  setLastError: (value: { operation: string; message: string; detail: string; at: string } | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  isProcessing: false,
  isSidebarOpen: false,
  lastOutputPath: null,
  lastError: null,
  setProcessing: (value) => set({ isProcessing: value }),
  setSidebarOpen: (value) => set({ isSidebarOpen: value }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setLastOutputPath: (value) => set({ lastOutputPath: value }),
  setLastError: (value) => set({ lastError: value }),
}))
