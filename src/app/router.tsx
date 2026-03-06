import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/app/layout/app-layout'
import { HistoryPage } from '@/pages/history/page'
import { OrganizerPage } from '@/pages/organizer/page'
import { QueuePage } from '@/pages/queue/page'
import { SettingsPage } from '@/pages/settings/page'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to='/organizer' replace /> },
      { path: 'dashboard', element: <Navigate to='/organizer' replace /> },
      { path: 'organizer', element: <OrganizerPage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
