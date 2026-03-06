import { FileStack, FolderTree, History, Settings, Command } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { twMerge } from 'tailwind-merge'
import { useI18n } from '@/i18n/useI18n'

const links = [
  { to: '/organizer', labelKey: 'nav.organizer', icon: FolderTree },
  { to: '/queue', labelKey: 'nav.queue', icon: FileStack },
  { to: '/history', labelKey: 'nav.history', icon: History },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
]

export function SidebarNav() {
  const { t } = useI18n()
  const location = useLocation()

  return (
    <aside className='flex h-full w-[240px] flex-shrink-0 flex-col bg-[#111113] border-r border-[#27272a] text-zinc-300'>
      <div className='p-3 m-3 hover:bg-[#27272a]/60 transition-colors cursor-pointer rounded-lg flex items-center gap-3 select-none'>
        <div className='h-8 w-8 rounded-md bg-zinc-100 text-zinc-950 flex shadow-sm items-center justify-center'>
          <Command size={16} strokeWidth={2.5} />
        </div>
        <div className='min-w-0'>
          <h1 className='text-sm font-semibold text-zinc-100 truncate tracking-tight'>{t('app.product')}</h1>
          <p className='text-[11px] text-zinc-500 font-medium tracking-wide'>{t('app.workspace')}</p>
        </div>
      </div>
      
      <div className='px-5 py-2 text-[10px] font-semibold text-zinc-500 mt-2 tracking-wider uppercase select-none'>
        {t('app.menu')}
      </div>
      
      <nav className='flex-1 px-3 space-y-0.5 overflow-y-auto custom-scrollbar pt-1'>
        {links.map((link) => {
          const Icon = link.icon
          const isActive = location.pathname.startsWith(link.to)

          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={twMerge(
                'group flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all duration-200 select-none',
                isActive
                  ? 'bg-[#27272a] text-zinc-100 shadow-sm'
                  : 'text-zinc-400 hover:bg-[#27272a]/40 hover:text-zinc-200'
              )}
            >
              <Icon size={16} className={twMerge('transition-colors', isActive ? 'text-blue-400' : 'text-zinc-500 group-hover:text-zinc-300')} />
              <span className='truncate'>{t(link.labelKey)}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className='mt-auto p-4 flex items-center justify-between border-t border-[#27272a] bg-[#111113]/50'>
        <div className='flex items-center gap-2 text-[11px] font-medium text-zinc-500 select-none'>
          <div className='h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'></div>
          {t('app.connected')}
        </div>
        <div className='text-[10px] text-zinc-600 font-mono'>v0.2.0</div>
      </div>
    </aside>
  )
}
