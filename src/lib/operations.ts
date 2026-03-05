export type OperationId =
  | 'merge_pdf_rename'
  | 'split_pdf'
  | 'csv_filter_xlsx_export'
  | 'batch_rename'
  | 'images_to_pdf'

export const operationOptions: Array<{ id: OperationId; translationKey: string }> = [
  { id: 'merge_pdf_rename', translationKey: 'operations.merge_pdf_rename' },
  { id: 'split_pdf', translationKey: 'operations.split_pdf' },
  { id: 'csv_filter_xlsx_export', translationKey: 'operations.csv_filter_xlsx_export' },
  { id: 'batch_rename', translationKey: 'operations.batch_rename' },
  { id: 'images_to_pdf', translationKey: 'operations.images_to_pdf' },
]

const legacyToId: Record<string, OperationId> = {
  'Merge PDF + Rename': 'merge_pdf_rename',
  'Split PDF': 'split_pdf',
  'CSV Filter + XLSX Export': 'csv_filter_xlsx_export',
  'Batch Rename': 'batch_rename',
  'Images to PDF': 'images_to_pdf',
}

export function normalizeOperationId(value: string): OperationId | string {
  return legacyToId[value] ?? value
}

export function operationKeyFromId(value: string): string {
  const normalized = normalizeOperationId(value)
  if (
    normalized === 'merge_pdf_rename' ||
    normalized === 'split_pdf' ||
    normalized === 'csv_filter_xlsx_export' ||
    normalized === 'batch_rename' ||
    normalized === 'images_to_pdf'
  ) {
    return `operations.${normalized}`
  }
  return value
}
