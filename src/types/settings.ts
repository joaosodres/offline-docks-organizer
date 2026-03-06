export type AppSettings = {
  outputDirectory: string
  defaultRenamePattern: string
  language: 'en' | 'pt-BR' | 'es'
}

export const defaultSettings: AppSettings = {
  outputDirectory: '~/Documents/OfflineDocsToolkit',
  defaultRenamePattern: '{client}_{date}_{seq}',
  language: 'pt-BR',
}
