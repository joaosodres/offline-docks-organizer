import { useMemo } from 'react'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { translations, type SupportedLanguage } from '@/i18n/translations'

function getByPath(source: unknown, path: string): string | undefined {
  const result = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), source)
  return typeof result === 'string' ? result : undefined
}

export function useI18n() {
  const language = useSettingsStore((state) => state.settings.language as SupportedLanguage)

  const dictionary = useMemo(() => translations[language] ?? translations.en, [language])

  const t = (key: string) => getByPath(dictionary, key) ?? key

  return {
    language,
    t,
  }
}
