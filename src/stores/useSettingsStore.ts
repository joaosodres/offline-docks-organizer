import { create } from 'zustand'
import { AppSettings } from '@/types/settings'

type SettingsState = {
  settings: AppSettings
  updateSettings: (next: Partial<AppSettings>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    outputDirectory: '~/Documents/OfflineDocsToolkit',
    defaultRenamePattern: '{client}_{date}_{seq}',
    language: 'pt-BR',
  },
  updateSettings: (next) =>
    set((state) => ({
      settings: { ...state.settings, ...next },
    })),
}))
