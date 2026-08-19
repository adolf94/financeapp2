import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { AuthProvider } from '@adolf94/ar-auth-client'
import { registerSW } from 'virtual:pwa-register'
import { router } from './router'
import { Toaster } from 'react-hot-toast'
import './index.css'

registerSW({ immediate: true })

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10, // 10 minutes
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'FINANCE_QUERY_CACHE',
})

const authConfig = window.authConfig ?? {
  authority: 'https://auth.adolfrey.com/api',
  clientId: 'finance-app2',
  redirectUri: "http://localhost:5173",
  scope: 'openid profile email api://finance-app-api/user'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider config={authConfig}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7, buster: 'v1.0' }}
      >
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </PersistQueryClientProvider>
    </AuthProvider>
  </React.StrictMode>,
)
