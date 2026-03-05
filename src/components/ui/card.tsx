import { PropsWithChildren } from 'react'
import { cn } from '@/lib/cn'

type CardProps = PropsWithChildren<{
  className?: string
}>

export function Card({ className, children }: CardProps) {
  return <section className={cn('glass-panel rounded-2xl p-6', className)}>{children}</section>
}
