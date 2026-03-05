import { create } from 'zustand'

type SelectionState = {
  selectedPaths: string[]
  setSelectedPaths: (paths: string[]) => void
  clearSelection: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedPaths: [],
  setSelectedPaths: (paths) => set({ selectedPaths: paths }),
  clearSelection: () => set({ selectedPaths: [] }),
}))
