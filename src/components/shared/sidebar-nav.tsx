import { FileStack, FolderTree, History, Home, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '@/i18n/useI18n'

const links = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: Home },
  { to: '/organizer', labelKey: 'nav.organizer', icon: FolderTree },
  { to: '/queue', labelKey: 'nav.queue', icon: FileStack },
  { to: '/history', labelKey: 'nav.history', icon: History },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
]

export function SidebarNav() {
  const { t } = useI18n()

  return (
    <aside className='border-r border-[var(--border)] bg-[var(--surface)] p-4'>
      <div className='mb-8'>
        <p className='text-xs uppercase tracking-[0.2em] text-[var(--muted)]'>{t('app.product')}</p>
        <h1 className='mt-2 text-lg font-semibold'>{t('app.tagline')}</h1>
      </div>

      <nav className='space-y-2'>
        {links.map((link) => {
          const Icon = link.icon
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--text)] hover:bg-black/5',
                ].join(' ')
              }
            >
              <Icon size={16} />
              {t(link.labelKey)}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
