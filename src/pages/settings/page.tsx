import { ChangeEvent } from 'react'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/useI18n'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { AppSettings } from '@/types/settings'

export function SettingsPage() {
  const { t } = useI18n()
  const settings = useSettingsStore((state) => state.settings)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const handleOutputDirectoryChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateSettings({ outputDirectory: event.target.value })
  }

  const handlePatternChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateSettings({ defaultRenamePattern: event.target.value })
  }

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ language: event.target.value as AppSettings['language'] })
  }

  return (
    <div className='space-y-4'>
      <header>
        <h2 className='text-2xl font-semibold'>{t('settings.title')}</h2>
        <p className='text-sm text-[var(--muted)]'>{t('settings.subtitle')}</p>
      </header>

      <Card className='space-y-4'>
        <label className='grid gap-1 text-sm'>
          {t('settings.outputDirectory')}
          <input
            className='rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm'
            value={settings.outputDirectory}
            onChange={handleOutputDirectoryChange}
          />
        </label>

        <label className='grid gap-1 text-sm'>
          {t('settings.defaultRenamePattern')}
          <input
            className='rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm'
            value={settings.defaultRenamePattern}
            onChange={handlePatternChange}
          />
        </label>

        <label className='grid gap-1 text-sm'>
          {t('common.language')}
          <select
            className='rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm'
            value={settings.language}
            onChange={handleLanguageChange}
          >
            <option value='pt-BR'>Portugues (Brasil)</option>
            <option value='en'>English</option>
            <option value='es'>Espanol</option>
          </select>
        </label>
      </Card>
    </div>
  )
}
