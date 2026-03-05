type ProgressProps = {
  value: number
}

export function Progress({ value }: ProgressProps) {
  return (
    <div className='h-2 w-full overflow-hidden rounded bg-[var(--surface-2)]'>
      <div className='h-full bg-[var(--primary)] transition-all' style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  )
}
