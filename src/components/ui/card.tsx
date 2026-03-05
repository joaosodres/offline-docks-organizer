import { PropsWithChildren } from 'react'
import { cn } from '@/lib/cn'

type CardProps = PropsWithChildren<{
  className?: string
}>

export function Card({ className, children }: CardProps) {
  return <section className={cn('rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4', className)}>{children}</section>
}
