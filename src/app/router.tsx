import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppLayout } from '@/app/layout/app-layout'
import { OrganizerPage } from '@/pages/organizer/page'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to='/organizer' replace /> },
      { path: 'dashboard', element: <Navigate to='/organizer' replace /> },
      { path: 'organizer', element: <OrganizerPage /> },
      { path: 'queue', element: <Navigate to='/organizer' replace /> },
      { path: 'history', element: <Navigate to='/organizer' replace /> },
      { path: 'settings', element: <Navigate to='/organizer' replace /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
