import { ChangeEvent, ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/useI18n'
import { usePresetStore } from '@/stores/usePresetStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import type { AppSettings } from '@/types/settings'

function FieldShell(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className='grid gap-2'>
      <div className='space-y-1'>
        <p className='text-sm font-medium text-zinc-200'>{props.label}</p>
        {props.hint && <p className='text-xs text-zinc-500'>{props.hint}</p>}
      </div>
      {props.children}
    </label>
  )
}

export function SettingsPage() {
  const { t } = useI18n()
  const settings = useSettingsStore((state) => state.settings)
  const presets = usePresetStore((state) => state.presets)
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
    <div className='h-full overflow-y-auto bg-[#09090b] px-6 py-8'>
      <div className='mx-auto max-w-6xl space-y-6'>
        <header className='space-y-2'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('nav.settings')}</p>
          <h2 className='text-3xl font-semibold tracking-tight text-zinc-100'>{t('settings.title')}</h2>
          <p className='max-w-2xl text-sm text-zinc-500'>{t('settings.subtitle')}</p>
        </header>

        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]'>
          <Card className='space-y-5 border border-[#27272a] bg-[#101014] p-6'>
            <div className='space-y-1'>
              <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('settings.appDefaults')}</p>
              <p className='text-sm text-zinc-500'>{t('settings.appDefaultsHint')}</p>
            </div>

            <FieldShell
              label={t('settings.outputDirectory')}
              hint={t('settings.outputDirectoryHint')}
            >
              <input
                className='w-full rounded-xl border border-[#27272a] bg-[#0b0b0e] px-4 py-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                value={settings.outputDirectory}
                onChange={handleOutputDirectoryChange}
                placeholder='~/Documents/OfflineDocsToolkit'
              />
            </FieldShell>

            <FieldShell
              label={t('settings.defaultRenamePattern')}
              hint={t('settings.renamePatternHint')}
            >
              <input
                className='w-full rounded-xl border border-[#27272a] bg-[#0b0b0e] px-4 py-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                value={settings.defaultRenamePattern}
                onChange={handlePatternChange}
                placeholder='{name}_{date}_{seq}'
              />
            </FieldShell>

            <FieldShell
              label={t('common.language')}
              hint={t('settings.languageHint')}
            >
              <select
                className='w-full rounded-xl border border-[#27272a] bg-[#0b0b0e] px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                value={settings.language}
                onChange={handleLanguageChange}
              >
                <option value='pt-BR'>{t('settings.languages.ptBR')}</option>
                <option value='en'>{t('settings.languages.en')}</option>
                <option value='es'>{t('settings.languages.es')}</option>
              </select>
            </FieldShell>
          </Card>

          <div className='grid gap-4 self-start'>
            <Card className='border border-[#27272a] bg-[#101014] p-5'>
              <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('settings.presetsTitle')}</p>
              <p className='mt-2 text-3xl font-semibold text-zinc-100'>{presets.length}</p>
              <p className='mt-1 text-sm text-zinc-500'>{t('settings.presetsCount')}</p>
            </Card>

            <Card className='border border-[#27272a] bg-[#101014] p-5'>
              <p className='text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500'>{t('settings.currentRenameTemplate')}</p>
              <p className='mt-2 break-all rounded-xl border border-[#27272a] bg-[#0b0b0e] px-3 py-2 text-sm text-zinc-300'>
                {settings.defaultRenamePattern}
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
