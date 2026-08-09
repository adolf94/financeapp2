import { useState, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router'
import { LayoutDashboard, ArrowLeftRight, Wallet, Settings, Plus, LogOut, Inbox } from 'lucide-react'
import AddTransactionModal from '@/components/AddTransactionModal'
import { useAuth } from '@adolf94/ar-auth-client'
import { useSignalR } from '@/hooks/useSignalR'

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { path: '/ingestions', label: 'Inbox', icon: Inbox },
  { path: '/accounts', label: 'Accounts', icon: Wallet },
  { path: '/settings', label: 'Settings', icon: Settings },
]

export default function AppLayout() {
  const { isAuthenticated, isLoading, login, logout, user } = useAuth()
  
  // Connect to SignalR connection announcements when authenticated
  useSignalR(!isLoading && isAuthenticated)

  const navigate = useNavigate()
  const location = useLocation()
  const currentPath = location.pathname

  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      login({ useRedirect: true })
    }
  }, [isLoading, isAuthenticated, login])

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-lg font-medium text-slate-400">Authenticating...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full max-w-5xl mx-auto relative bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          {user?.picture ? (
            <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <span className="font-medium text-slate-900 dark:text-slate-100">{user?.name || 'User'}</span>
        </div>
        <button
          onClick={() => logout()}
          aria-label="Logout"
          className="flex items-center gap-2 text-sm font-medium text-red-500 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      {/* FAB — Add Transaction */}
      <button
        id="fab-add-transaction"
        aria-label="Add transaction"
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-[90px] right-6 z-50 w-[64px] h-[64px] rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center cursor-pointer hover:bg-blue-700 active:scale-95 transition-all duration-200"
      >
        <Plus className="w-[32px] h-[32px]" strokeWidth={2} />
      </button>

      {/* Add Transaction Modal */}
      <AddTransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Bottom Navigation */}
      <nav
        id="bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 max-w-5xl mx-auto"
      >
        <div className="flex items-stretch">
          {navItems.map(({ path, label, icon: Icon }) => {
            const isActive = currentPath === path
            return (
              <button
                key={path}
                id={`nav-${label.toLowerCase()}`}
                onClick={() => navigate({ to: path })}
                aria-label={label}
                className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-[60px] cursor-pointer transition-colors duration-200
                  ${isActive
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
              >
                <Icon className="w-6 h-6" strokeWidth={1.5} />
                <span className="text-xs font-medium">{label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
