import { Outlet, useLocation } from 'react-router-dom'
import { SidebarNav } from '@/components/shared/sidebar-nav'
import { motion, AnimatePresence } from 'framer-motion'
import { useUiStore } from '@/stores/useUiStore'

export function AppLayout() {
  const location = useLocation()
  const isSidebarOpen = useUiStore((state) => state.isSidebarOpen)

  return (
    <div className='flex h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-blue-500/30'>
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div
            key='sidebar'
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className='h-full flex-shrink-0 overflow-hidden'
          >
            <SidebarNav />
          </motion.div>
        )}
      </AnimatePresence>
      <main className='flex-1 relative flex flex-col min-w-0'>
        <AnimatePresence mode='wait'>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className='h-full flex flex-col flex-1 min-h-0'
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
