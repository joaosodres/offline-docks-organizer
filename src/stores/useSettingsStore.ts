import { create } from 'zustand'
import { AppSettings, defaultSettings } from '@/types/settings'

type SettingsState = {
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  updateSettings: (next: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  setSettings: (settings) => set({ settings }),
  updateSettings: (next) =>
    set((state) => ({
      settings: { ...state.settings, ...next },
    })),
}))
