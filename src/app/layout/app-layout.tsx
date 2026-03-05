import { Outlet } from 'react-router-dom'

export function AppLayout() {
  return (
    <div className='min-h-screen bg-[var(--bg)] text-[var(--text)]'>
      <main className='mx-auto w-full max-w-[1800px] p-6'>
        <Outlet />
      </main>
    </div>
  )
}
