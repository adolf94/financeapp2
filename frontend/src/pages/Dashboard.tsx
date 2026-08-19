import { Wallet } from 'lucide-react'
import { useAnalysis } from '@/hooks/useAnalysis'
import { useState } from 'react'
import Analysis from '@/pages/Analysis'
import { DashboardOverviewSkeleton } from '@/components/ui/Skeleton'

export default function Dashboard() {
  const { netWorth, currentMonthIncome, currentMonthExpense, isLoading } = useAnalysis()
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis'>('overview')

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
    }).format(amount)
  }

  return (
    <div className="p-4 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Dashboard</h1>
        <p className="text-slate-500 mt-1 text-sm">Welcome back</p>
      </header>

      {/* Tabs */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('analysis')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'analysis'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Analysis
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
          {isLoading ? (
            <DashboardOverviewSkeleton />
          ) : (
            <>
              <section className="bg-blue-600 text-white p-5 rounded-2xl shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-5 h-5 opacity-80" />
                  <span className="text-sm font-medium opacity-90">Total Balance</span>
                </div>
                <div className="text-4xl font-bold tracking-tight">{formatCurrency(netWorth)}</div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-3">This Month</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-sm text-slate-500 block mb-1">Income</span>
                    <span className="text-xl font-bold text-emerald-500">+{formatCurrency(currentMonthIncome)}</span>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-sm text-slate-500 block mb-1">Expenses</span>
                    <span className="text-xl font-bold text-rose-500">-{formatCurrency(currentMonthExpense)}</span>
                  </div>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {activeTab === 'analysis' && (
        <div className="-mx-4">
          <Analysis />
        </div>
      )}
    </div>
  )
}
