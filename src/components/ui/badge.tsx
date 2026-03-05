import { cn } from '@/lib/cn'

type BadgeProps = {
  tone?: 'neutral' | 'success' | 'error' | 'running'
  children: string
}

const tones: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-[var(--surface-2)] text-[var(--text)]',
  success: 'bg-emerald-100 text-emerald-800',
  error: 'bg-rose-100 text-rose-800',
  running: 'bg-amber-100 text-amber-800',
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={cn('rounded-full px-2 py-1 text-xs font-medium', tones[tone])}>{children}</span>
}
