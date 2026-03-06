import { create } from 'zustand'
import type { JobPreset } from '@/types/preset'

type PresetState = {
  presets: JobPreset[]
  setPresets: (presets: JobPreset[]) => void
  upsertPreset: (preset: JobPreset) => void
  removePreset: (presetId: string) => void
}

export const usePresetStore = create<PresetState>((set) => ({
  presets: [],
  setPresets: (presets) => set({ presets }),
  upsertPreset: (preset) =>
    set((state) => {
      const index = state.presets.findIndex((item) => item.id === preset.id)
      if (index === -1) return { presets: [preset, ...state.presets] }

      const presets = [...state.presets]
      presets[index] = preset
      return { presets }
    }),
  removePreset: (presetId) =>
    set((state) => ({ presets: state.presets.filter((preset) => preset.id !== presetId) })),
}))
